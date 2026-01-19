import { useCallback } from "react";
import { LAMPORTS_PER_SOL, PublicKey, Connection } from "@solana/web3.js";
import Decimal from "decimal.js";
import BN from "bn.js";
import { createSwapTransaction } from "@/lib/raydium-clmm";

const getConnection = () => {
  return new Connection(import.meta.env.VITE_HELIUS_RPC_URL);
};

export const useTrade = (
  tokenAddress: string,
  tokenAtomicBalance: Decimal,
) => {
  const createTransaction = useCallback(
    async (params: { direction: "buy" | "sell", value: number, signer: PublicKey }) => {
      const { direction, value, signer } = params;

      let atomicAmount: BN;
      if (direction === "buy") {
        atomicAmount = new BN(
          new Decimal(value).mul(LAMPORTS_PER_SOL).floor().toString()
        );
      } else {
        atomicAmount = new BN(
          tokenAtomicBalance.mul(value).div(100).floor().toString()
        );
      }

      if (atomicAmount.isZero() || atomicAmount.isNeg()) {
        throw new Error("Invalid amount");
      }

      const connection = getConnection();
      const tokenMint = new PublicKey(tokenAddress);

      const transaction = await createSwapTransaction(
        connection,
        signer,
        tokenMint,
        atomicAmount,
        direction
      );

      return transaction;
    },
    [tokenAddress, tokenAtomicBalance],
  );
  
  return {
    createTransaction,
  };
};
