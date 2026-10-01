'use client';

import dynamic from 'next/dynamic';

// The charting engine is strictly client-side (canvas + workers).
const ChartWorkspace = dynamic(
  () => import('@/components/workspace/chart-workspace').then((m) => m.ChartWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0b0d10]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#262c37] border-t-[#e3b341]" />
          <span className="font-mono text-xs text-[#585f6d]">Loading chart engine…</span>
        </div>
      </div>
    ),
  },
);

export default function Home() {
  return <ChartWorkspace />;
}
