import { useCallback, useState, memo } from "react";
import { toast } from "sonner";
import { X, GripHorizontal, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { EnhancedToken } from "@codex-data/sdk/dist/sdk/generated/graphql";
import { useBalance } from "@/hooks/use-balance";
import { useTrade } from "@/hooks/use-trade";
import { useDraggable } from "@/hooks/use-draggable";
import { confirmTransaction, createConnection, createKeypair, sendTransaction, signTransaction } from "@/lib/solana";

interface FloatingTradePanelProps {
  token: EnhancedToken;
  isOpen: boolean;
  onClose: () => void;
}

// Preset amounts for buying (in SOL)
const BUY_PRESETS = [0.001, 0.01, 0.1, 1];

// Preset percentages for selling
const SELL_PRESETS = [10, 25, 50, 100];

export const FloatingTradePanel = memo(function FloatingTradePanel({ 
  token, 
  isOpen, 
  onClose 
}: FloatingTradePanelProps) {
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState("");
  const [sellPercentage, setSellPercentage] = useState("");
  const [isTrading, setIsTrading] = useState(false);

  const { nativeBalance: solanaBalance, tokenBalance, tokenAtomicBalance, refreshBalance } = useBalance(
    token.address,
    Number(token.decimals),
    9,
    Number(token.networkId)
  );
  const { createTransaction } = useTrade(token.address, tokenAtomicBalance);

  // Position is managed internally
  const { position, elementRef, handleMouseDown } = useDraggable({
    initialPosition: { x: 100, y: 100 },
  });

  const keypair = createKeypair(import.meta.env.VITE_SOLANA_PRIVATE_KEY);
  const connection = createConnection();

  const handleTrade = useCallback(async () => {
    const value = tradeMode === "buy" ? parseFloat(buyAmount) : parseFloat(sellPercentage);
    if (!value || value <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsTrading(true);
    const toastId = toast.loading("Submitting trade...");

    try {
      const transaction = await createTransaction({
        direction: tradeMode,
        value,
        signer: keypair.publicKey,
      });

      toast.loading("Signing...", { id: toastId });
      const signedTransaction = signTransaction(keypair, transaction);

      toast.loading("Sending...", { id: toastId });
      const signature = await sendTransaction(signedTransaction, connection);

      toast.loading("Confirming...", { id: toastId });
      const confirmation = await confirmTransaction(signature, connection);

      if (confirmation.value.err) {
        throw new Error("Trade failed");
      }

      toast.success(`Success! TX: ${signature.slice(0, 8)}...`, { id: toastId });
      
      setBuyAmount("");
      setSellPercentage("");
      
      setTimeout(refreshBalance, 1000);
    } catch (error) {
      toast.error((error as Error).message, { id: toastId });
    } finally {
      setIsTrading(false);
    }
  }, [tradeMode, buyAmount, sellPercentage, createTransaction, keypair, connection, refreshBalance]);

  const handleQuickBuy = useCallback((amount: number) => {
    setBuyAmount(amount.toString());
  }, []);

  const handleQuickSell = useCallback((percentage: number) => {
    setSellPercentage(percentage.toString());
  }, []);

  if (!isOpen) return null;

  const tokenSymbol = token.symbol || "Token";

  return (
    <div
      ref={elementRef}
      onMouseDown={handleMouseDown}
      className="fixed z-50 bg-[#0a0a0a] border border-[#222] shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: 320,
        minHeight: 360,
      }}
    >
      <div
        data-drag-handle
        className="flex items-center justify-between px-3 py-2 bg-[#111] border-b border-[#222] cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-4 h-4 text-gray-500" />
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-medium text-gray-200">Instant Trade</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[#222] rounded transition-colors"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-[#222] space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">SOL Balance</span>
          <span className="text-gray-300 font-mono">{solanaBalance.toFixed(4)} SOL</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">{tokenSymbol} Balance</span>
          <span className="text-gray-300 font-mono">{tokenBalance.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex border-b border-[#222]">
        <button
          onClick={() => setTradeMode("buy")}
          className={cn(
            "flex-1 py-2.5 text-sm font-semibold transition-all",
            tradeMode === "buy"
              ? "bg-green-500/10 text-green-400 border-b-2 border-green-500"
              : "text-gray-500 hover:text-gray-300 hover:bg-[#111]"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setTradeMode("sell")}
          className={cn(
            "flex-1 py-2.5 text-sm font-semibold transition-all",
            tradeMode === "sell"
              ? "bg-red-500/10 text-red-400 border-b-2 border-red-500"
              : "text-gray-500 hover:text-gray-300 hover:bg-[#111]"
          )}
        >
          Sell
        </button>
      </div>

      <div className="p-3 space-y-3">
        {tradeMode === "buy" ? (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {BUY_PRESETS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleQuickBuy(amount)}
                  className={cn(
                    "py-2 text-xs font-medium rounded transition-all",
                    buyAmount === amount.toString()
                      ? "bg-green-500 text-black"
                      : "bg-[#1a1a1a] text-gray-400 hover:bg-[#222] hover:text-gray-200"
                  )}
                >
                  {amount}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="number"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 bg-[#111] border border-[#222] text-gray-200 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-green-500/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                SOL
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {SELL_PRESETS.map((pct) => (
                <button
                  key={pct}
                  onClick={() => handleQuickSell(pct)}
                  className={cn(
                    "py-2 text-xs font-medium rounded transition-all",
                    sellPercentage === pct.toString()
                      ? "bg-red-500 text-white"
                      : "bg-[#1a1a1a] text-gray-400 hover:bg-[#222] hover:text-gray-200"
                  )}
                >
                  {pct}%
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="number"
                value={sellPercentage}
                onChange={(e) => setSellPercentage(e.target.value)}
                placeholder="0"
                min="0"
                max="100"
                className="w-full px-3 py-2.5 bg-[#111] border border-[#222] text-gray-200 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-red-500/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                %
              </span>
            </div>

            {sellPercentage && tokenBalance > 0 && (
              <div className="text-xs text-gray-500">
                Selling: {((tokenBalance * parseFloat(sellPercentage || "0")) / 100).toLocaleString()} {tokenSymbol}
              </div>
            )}
          </>
        )}

        <button
          onClick={handleTrade}
          disabled={
            isTrading ||
            (tradeMode === "buy" && (!buyAmount || parseFloat(buyAmount) <= 0)) ||
            (tradeMode === "sell" && (!sellPercentage || parseFloat(sellPercentage) <= 0))
          }
          className={cn(
            "w-full py-3 text-sm font-bold transition-all",
            tradeMode === "buy"
              ? "bg-green-500 hover:bg-green-400 text-black disabled:bg-green-500/20 disabled:text-green-500/40"
              : "bg-red-500 hover:bg-red-400 text-white disabled:bg-red-500/20 disabled:text-red-500/40",
            "disabled:cursor-not-allowed"
          )}
        >
          {isTrading ? "Processing..." : `${tradeMode === "buy" ? "Buy" : "Sell"} ${tokenSymbol}`}
        </button>
      </div>
    </div>
  );
});
