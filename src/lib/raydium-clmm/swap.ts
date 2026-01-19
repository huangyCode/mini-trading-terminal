import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from '@solana/spl-token';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import {
  RAYDIUM_CLMM_PROGRAM_ID,
  WSOL_MINT,
  SWAP_V2_DISCRIMINATOR,
  DEFAULT_SLIPPAGE_BPS,
  COMPUTE_BUDGET_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from './constants';
import { PoolState } from './layouts';
import {
  findClmmPool,
  isToken0ToToken1,
  getSwapTickArrays,
  getPoolPrice,
  getTickArrayBitmapExtension,
} from './pool';

function calculateMinAmountOut(
  poolState: PoolState,
  amountIn: BN,
  a2b: boolean,
  slippageBps: number
): BN {
  const price = getPoolPrice(poolState);
  const decimals0 = poolState.mintDecimals0;
  const decimals1 = poolState.mintDecimals1;
  
  let estimatedAmountOut: Decimal;
  
  if (a2b) {
    // 0-1 output = input * price
    const inputDecimal = new Decimal(amountIn.toString()).div(new Decimal(10).pow(decimals0));
    estimatedAmountOut = inputDecimal.mul(price).mul(new Decimal(10).pow(decimals1));
  } else {
    // 1-0 output = input / price
    const inputDecimal = new Decimal(amountIn.toString()).div(new Decimal(10).pow(decimals1));
    estimatedAmountOut = inputDecimal.div(price).mul(new Decimal(10).pow(decimals0));
  }
  
  const slippageMultiplier = new Decimal(10000 - slippageBps).div(10000);
  return new BN(estimatedAmountOut.mul(slippageMultiplier).floor().toFixed(0));
}

function buildSwapInstruction(params: {
  poolAddress: PublicKey;
  poolState: PoolState;
  userWallet: PublicKey;
  userTokenAccountIn: PublicKey;
  userTokenAccountOut: PublicKey;
  amountIn: BN;
  minAmountOut: BN;
  tickArrayAddresses: PublicKey[];
  tickArrayBitmapExtension: PublicKey;
  a2b: boolean;
  inputMint: PublicKey;
  outputMint: PublicKey;
}): TransactionInstruction {
  const {
    poolAddress,
    poolState,
    userWallet,
    userTokenAccountIn,
    userTokenAccountOut,
    amountIn,
    minAmountOut,
    tickArrayAddresses,
    tickArrayBitmapExtension,
    a2b,
    inputMint,
    outputMint,
  } = params;

  const inputVault = a2b ? poolState.tokenVault0 : poolState.tokenVault1;
  const outputVault = a2b ? poolState.tokenVault1 : poolState.tokenVault0;
  
  const data = Buffer.alloc(41);
  let offset = 0;
  

  SWAP_V2_DISCRIMINATOR.copy(data, offset);
  offset += 8;
  
  data.writeBigUInt64LE(BigInt(amountIn.toString()), offset);
  offset += 8;
  
  data.writeBigUInt64LE(BigInt(minAmountOut.toString()), offset);
  offset += 8;
  
  data.writeBigUInt64LE(BigInt(0), offset);
  offset += 8;

  data.writeBigUInt64LE(BigInt(0), offset);
  offset += 8;
  
  data.writeUInt8(1, offset);

  const keys = [
    { pubkey: userWallet, isSigner: true, isWritable: true },// 0. payer
    { pubkey: poolState.ammConfig, isSigner: false, isWritable: false },// 1. amm_config
    { pubkey: poolAddress, isSigner: false, isWritable: true },// 2. pool_state
    { pubkey: userTokenAccountIn, isSigner: false, isWritable: true },// 3. input_token_account
    { pubkey: userTokenAccountOut, isSigner: false, isWritable: true },// 4. output_token_account
    { pubkey: inputVault, isSigner: false, isWritable: true },// 5. input_vault
    { pubkey: outputVault, isSigner: false, isWritable: true },// 6. output_vault
    { pubkey: poolState.observationKey, isSigner: false, isWritable: true },// 7. observation_state
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },// 8. token_program
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },// 9. token_program_2022
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false }, // 10. memo_program
    { pubkey: inputMint, isSigner: false, isWritable: false },// 11. input_vault_mint
    { pubkey: outputMint, isSigner: false, isWritable: false }, // 12. output_vault_mint
    { pubkey: tickArrayBitmapExtension, isSigner: false, isWritable: true },// 13. tick_array_bitmap_extension
    { pubkey: tickArrayAddresses[0], isSigner: false, isWritable: true },// 14. tick_array_0
    { pubkey: tickArrayAddresses[1], isSigner: false, isWritable: true }, // 15. tick_array_1
  ];
  
  return new TransactionInstruction({
    programId: RAYDIUM_CLMM_PROGRAM_ID,
    keys,
    data,
  });
}


function createComputeBudgetInstructions(
  units: number = 400000,
  microLamports: number = 100000
): TransactionInstruction[] {
  const limitData = Buffer.alloc(9);
  limitData.writeUInt8(2, 0);
  limitData.writeUInt32LE(units, 1);

  const priceData = Buffer.alloc(9);
  priceData.writeUInt8(3, 0);
  priceData.writeBigUInt64LE(BigInt(microLamports), 1);

  return [
    new TransactionInstruction({ programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: limitData }),
    new TransactionInstruction({ programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: priceData }),
  ];
}


async function accountExists(connection: Connection, address: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null;
}

export async function createSwapTransaction(
  connection: Connection,
  userWallet: PublicKey,
  tokenMint: PublicKey,
  amountIn: BN,
  direction: 'buy' | 'sell',
  slippageBps: number = DEFAULT_SLIPPAGE_BPS
): Promise<VersionedTransaction> {
  const poolResult = await findClmmPool(connection, tokenMint, WSOL_MINT);
  if (!poolResult) {
    throw new Error(`No CLMM pool found for token ${tokenMint.toBase58()}`);
  }

  const { poolAddress, poolState } = poolResult;

  const inputMint = direction === 'buy' ? WSOL_MINT : tokenMint;
  const outputMint = direction === 'buy' ? tokenMint : WSOL_MINT;
  const a2b = isToken0ToToken1(poolState, inputMint);

  const minAmountOut = calculateMinAmountOut(poolState, amountIn, a2b, slippageBps);

  const tickArrayBitmapExtension = getTickArrayBitmapExtension(poolAddress);

  const tickArrayAddresses = await getSwapTickArrays(connection, poolAddress, poolState, a2b);

  const userInputAccount = getAssociatedTokenAddressSync(inputMint, userWallet);
  const userOutputAccount = getAssociatedTokenAddressSync(outputMint, userWallet);

  const instructions: TransactionInstruction[] = [];

  instructions.push(...createComputeBudgetInstructions());

  const inputAccountExists = await accountExists(connection, userInputAccount);
  const outputAccountExists = await accountExists(connection, userOutputAccount);

  if (direction === 'buy') {
    if (!inputAccountExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(userWallet, userInputAccount, userWallet, NATIVE_MINT)
      );
    }
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: userWallet,
        toPubkey: userInputAccount,
        lamports: BigInt(amountIn.toString()),
      }),
      createSyncNativeInstruction(userInputAccount)
    );
  }

  if (!outputAccountExists) {
    instructions.push(
      createAssociatedTokenAccountInstruction(userWallet, userOutputAccount, userWallet, outputMint)
    );
  }

  instructions.push(
    buildSwapInstruction({
      poolAddress,
      poolState,
      userWallet,
      userTokenAccountIn: userInputAccount,
      userTokenAccountOut: userOutputAccount,
      amountIn,
      minAmountOut,
      tickArrayAddresses,
      tickArrayBitmapExtension,
      a2b,
      inputMint,
      outputMint,
    })
  );

  if (direction === 'sell') {
    instructions.push(createCloseAccountInstruction(userOutputAccount, userWallet, userWallet));
  }

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey: userWallet,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}
