import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface PoolState {
  ammConfig: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  observationKey: PublicKey;
  mintDecimals0: number;
  mintDecimals1: number;
  tickSpacing: number;
  sqrtPriceX64: BN;
  tickCurrent: number;
}

export function parsePoolState(data: Buffer): PoolState {
  return {
    ammConfig: new PublicKey(data.subarray(9, 41)),
    tokenMint0: new PublicKey(data.subarray(73, 105)),
    tokenMint1: new PublicKey(data.subarray(105, 137)),
    tokenVault0: new PublicKey(data.subarray(137, 169)),
    tokenVault1: new PublicKey(data.subarray(169, 201)),
    observationKey: new PublicKey(data.subarray(201, 233)),
    mintDecimals0: data.readUInt8(233),
    mintDecimals1: data.readUInt8(234),
    tickSpacing: data.readUInt16LE(235),
    sqrtPriceX64: new BN(data.subarray(253, 269), 'le'),
    tickCurrent: data.readInt32LE(269),
  };
}
