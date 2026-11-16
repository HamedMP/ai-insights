"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons"

import { fadeTheme } from "@/components/theme-provider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "system", label: "System", icon: ComputerIcon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
] as const

/** Light, system and dark as one segmented control; a thumb slides to the active choice. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const active = mounted ? OPTIONS.findIndex((option) => option.value === theme) : -1

  return (
    <div role="radiogroup" aria-label="Colour theme" className={cn("relative inline-flex h-9 items-center rounded-full border bg-secondary/70 p-0.5 backdrop-blur", className)}>
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 size-8 rounded-full border bg-background shadow-sm transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          active < 0 && "opacity-0",
        )}
        style={{ transform: `translateX(${Math.max(0, active) * 2}rem)` }}
      />
      {OPTIONS.map((option) => {
        const selected = mounted && theme === option.value
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${option.label} theme`}
                  onClick={() => fadeTheme(() => setTheme(option.value))}
                  className={cn(
                    "relative z-10 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected && "text-foreground",
                  )}
                />
              }
            >
              <HugeiconsIcon icon={option.icon} strokeWidth={2} className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {option.label}
              {option.value !== "system" && <span className="ml-1 font-mono opacity-60">d</span>}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
