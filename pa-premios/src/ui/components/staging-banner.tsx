import { STAGING_BANNER } from "@/ui/copy";

export function StagingBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-amber-400 px-4 py-1 text-center text-sm font-bold tracking-wide text-black"
    >
      {STAGING_BANNER}
    </div>
  );
}
