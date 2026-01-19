import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import {
  RAYDIUM_CLMM_PROGRAM_ID,
  WSOL_MINT,
  TICK_ARRAY_SEED,
  TICK_ARRAY_SIZE,
} from './constants';
import { parsePoolState, PoolState } from './layouts';

export async function findClmmPool(
  connection: Connection,
  tokenMintA: PublicKey,
  tokenMintB: PublicKey = WSOL_MINT
): Promise<{ poolAddress: PublicKey; poolState: PoolState } | null> {
  const [mint0, mint1] = sortMints(tokenMintA, tokenMintB);

  const accounts = await connection.getProgramAccounts(RAYDIUM_CLMM_PROGRAM_ID, {
    filters: [
      { dataSize: 1544 },
      {
        memcmp: {
          offset: 73,
          bytes: mint0.toBase58(),
        },
      },
      {
        memcmp: {
          offset: 105,
          bytes: mint1.toBase58(),
        },
      },
    ],
  });

  if (accounts.length === 0) {
    return null;
  }

  let bestPool = null;
  let highestLiquidity = new BN(0);

  for (const account of accounts) {
    const poolState = parsePoolState(account.account.data);
    const liquidity = new BN(account.account.data.subarray(237, 253), 'le');
    
    if (liquidity.gt(highestLiquidity)) {
      highestLiquidity = liquidity;
      bestPool = {
        poolAddress: account.pubkey,
        poolState,
      };
    }
  }

  if (!bestPool || highestLiquidity.isZero()) {
    return null;
  }

  return bestPool;
}

function sortMints(mintA: PublicKey, mintB: PublicKey): [PublicKey, PublicKey] {
  const comparison = mintA.toBuffer().compare(mintB.toBuffer());
  return comparison < 0 ? [mintA, mintB] : [mintB, mintA];
}

export function isToken0ToToken1(
  poolState: PoolState,
  inputMint: PublicKey
): boolean {
  return poolState.tokenMint0.equals(inputMint);
}

function getTickArrayStartIndex(tick: number, tickSpacing: number): number {
  const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
  let start = Math.trunc(tick / ticksInArray);
  if (tick < 0 && tick % ticksInArray !== 0) {
    start -= 1;
  }
  return start * ticksInArray;
}

function getTickArrayAddress(
  poolAddress: PublicKey,
  startIndex: number
): PublicKey {
  const startIndexBuffer = Buffer.alloc(4);
  startIndexBuffer.writeInt32LE(startIndex);

  const [tickArrayAddress] = PublicKey.findProgramAddressSync(
    [TICK_ARRAY_SEED, poolAddress.toBuffer(), startIndexBuffer],
    RAYDIUM_CLMM_PROGRAM_ID
  );

  return tickArrayAddress;
}

export async function getSwapTickArrays(
  connection: Connection,
  poolAddress: PublicKey,
  poolState: PoolState,
  a2b: boolean // true = token0 → token1, false = token1 → token0
): Promise<PublicKey[]> {
  const tickSpacing = poolState.tickSpacing;
  const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
  const currentTickArrayStart = getTickArrayStartIndex(poolState.tickCurrent, tickSpacing);

  const accounts = await connection.getProgramAccounts(RAYDIUM_CLMM_PROGRAM_ID, {
    filters: [
      { dataSize: 10240 },
      {
        memcmp: {
          offset: 8,
          bytes: poolAddress.toBase58(),
        },
      },
    ],
  });

  const tickArrayMap = new Map<number, PublicKey>();
  for (const acc of accounts) {
    const startTickIndex = acc.account.data.readInt32LE(40);
    tickArrayMap.set(startTickIndex, acc.pubkey);
  }
  const neededStarts: number[] = [];
  
  if (a2b) {
    neededStarts.push(currentTickArrayStart);
    neededStarts.push(currentTickArrayStart - ticksInArray);
  } else {
    neededStarts.push(currentTickArrayStart);
    neededStarts.push(currentTickArrayStart + ticksInArray);
  }

  const result: PublicKey[] = [];
  for (const start of neededStarts) {
    const existingAddr = tickArrayMap.get(start);
    if (existingAddr) {
      result.push(existingAddr);
    } else {
      result.push(getTickArrayAddress(poolAddress, start));
    }
  }

  return result;
}

export function getPoolAuthority(): PublicKey {
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    RAYDIUM_CLMM_PROGRAM_ID
  );
  return authority;
}

export function getTickArrayBitmapExtension(poolAddress: PublicKey): PublicKey {
  const [bitmapExtension] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_tick_array_bitmap_extension'), poolAddress.toBuffer()],
    RAYDIUM_CLMM_PROGRAM_ID
  );
  return bitmapExtension;
}

export function sqrtPriceX64ToPrice(
  sqrtPriceX64: BN,
  decimals0: number,
  decimals1: number
): Decimal {
  const sqrtPriceDecimal = new Decimal(sqrtPriceX64.toString());
  const Q64 = new Decimal(2).pow(64);
  const sqrtPrice = sqrtPriceDecimal.div(Q64);
  const price = sqrtPrice.mul(sqrtPrice);
  const decimalAdjustment = new Decimal(10).pow(decimals0 - decimals1);
  return price.mul(decimalAdjustment);
}

export function getPoolPrice(poolState: PoolState): Decimal {
  return sqrtPriceX64ToPrice(
    poolState.sqrtPriceX64,
    poolState.mintDecimals0,
    poolState.mintDecimals1
  );
}
