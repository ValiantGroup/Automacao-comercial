import { BrandLogo } from '@/components/brand-logo';

export default function DashboardLoading() {
  return (
    <div className="card mx-auto mt-10 flex w-full max-w-xl items-center gap-4 p-6">
      <div className="w-14 flex-shrink-0 opacity-75">
        <BrandLogo mode="icon" priority />
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold tracking-[0.16em] text-[#5C6673]">SYNCHRONIZING</p>
        <p className="mt-1 text-sm text-[#E6EDF3]">Carregando dados operacionais...</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#1F2937]">
          <div className="h-full w-1/2 rounded-full bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)] animate-shimmer" />
        </div>
      </div>
    </div>
  );
}
