import { BrandLogo } from '@/components/brand-logo';

export default function RootLoading() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(46,209,200,0.14)_0%,rgba(11,15,20,0)_48%),radial-gradient(circle_at_14%_18%,rgba(90,79,178,0.2)_0%,rgba(11,15,20,0)_52%)]" />
      <div className="relative z-10 w-full max-w-sm rounded-[24px] border border-[#1F2937] bg-[linear-gradient(180deg,rgba(26,35,48,0.92)_0%,rgba(18,24,33,0.95)_100%)] p-7 text-center">
        <div className="mx-auto w-[12rem] animate-float">
          <BrandLogo mode="full" priority />
        </div>
        <p className="mt-5 text-xs font-semibold tracking-[0.18em] text-[#5C6673]">LOADING EXPERIENCE</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#1F2937]">
          <div className="h-full w-2/3 rounded-full bg-[linear-gradient(135deg,#3A2F6B_0%,#1AA7A1_100%)] animate-shimmer" />
        </div>
      </div>
    </div>
  );
}
