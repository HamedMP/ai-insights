import { cn } from "@/lib/utils"

/** The AI Insights mark: an arc rises from now and points back down at a moment in the past. On hover it rewinds a little. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <rect width="64" height="64" rx="15" className="fill-primary" />
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5.5" className="text-white">
        <path d="M12 44H52" opacity=".5" />
        <g className="origin-[32.5px_32px] transition-transform duration-500 ease-[cubic-bezier(0.2,0.9,0.3,1.4)] group-hover/logo:-rotate-[18deg] motion-reduce:transition-none">
          <path d="M46 44V30A13.5 13.5 0 0 0 19 30" />
          <path d="M12.5 25 19 31.5l6.5-6.5" />
        </g>
      </g>
      <circle cx="19" cy="44" r="6" className="fill-white" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("group/logo inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[1.15rem] font-semibold tracking-tight">ai insights</span>
    </span>
  )
}
