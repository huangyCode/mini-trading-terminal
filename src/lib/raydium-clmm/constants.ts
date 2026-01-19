import { PublicKey } from '@solana/web3.js';

export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export const TICK_ARRAY_SEED = Buffer.from('tick_array');

export const TICK_ARRAY_SIZE = 60;

export const DEFAULT_SLIPPAGE_BPS = 500;

export const SWAP_V2_DISCRIMINATOR = Buffer.from([43, 4, 237, 11, 26, 201, 30, 98]);
