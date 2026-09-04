export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="glass-panel flex max-w-sm flex-col gap-3 rounded-3xl px-6 py-8">
        <h2 className="text-2xl font-bold text-slate-50">SwipeFi</h2>
        <p className="text-sm text-slate-400">
          Zap your USDC into stETH yield with a single swipe, powered by 1inch
          Aqua SwapVM.
        </p>
      </div>
    </div>
  );
}
