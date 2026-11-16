import { asset } from "@/lib/site"
import { cn } from "@/lib/utils"

/** The Matrix OS rabbit, in the current text colour (public/media/rabbit.svg, made from the report's own mark). */
export function Rabbit({ className }: { className?: string }) {
  const url = `url(${asset("media/rabbit.svg")})`
  return (
    <span
      aria-hidden
      className={cn("inline-block aspect-[510/660] h-[1.2em] shrink-0 bg-current", className)}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }}
    />
  )
}

/** The product's name as every card signs it. */
export function Wordmark({ className, by = true }: { className?: string; by?: boolean }) {
  return (
    <span className={cn("group/logo inline-flex items-center gap-2", className)}>
      <Rabbit className="h-[1.35em] text-primary" />
      <span className="text-[1.08rem] font-semibold tracking-[-0.02em]">AI Insights</span>
      {by && <span className="text-[12.5px] font-medium text-muted-foreground max-sm:hidden">by Matrix OS</span>}
    </span>
  )
}
