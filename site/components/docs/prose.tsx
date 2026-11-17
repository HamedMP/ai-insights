import { CopyButton } from "@/components/site/copy-button"
import { SiteLink } from "@/components/site/site-link"
import { cn } from "@/lib/utils"

/**
 * A link from a docs page to another page on this site. Another docs page (with or without "#section") opens in
 * place; a page that mounts Clerk, such as /leaderboard, loads as a new document (components/site/site-link.tsx).
 */
export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <SiteLink href={href} from="/docs">
      {children}
    </SiteLink>
  )
}

/** A section heading with its own anchor link. The id must match the page's entry in lib/docs.ts. */
export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="docs-h2 group scroll-mt-24">
      <a href={`#${id}`} className="docs-anchor">
        {children}
        <span aria-hidden className="docs-hash">
          #
        </span>
      </a>
    </h2>
  )
}

export function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="docs-h3 group scroll-mt-24">
      <a href={`#${id}`} className="docs-anchor">
        {children}
        <span aria-hidden className="docs-hash">
          #
        </span>
      </a>
    </h3>
  )
}

/**
 * A code block: a label saying what it is or where to run it, and a copy button (shown only when script runs; the
 * text is selectable either way). `copy` overrides what is copied, for example to leave out output lines.
 */
export function Code({ children, label = "Terminal", copy, className }: { children: string; label?: string; copy?: string | false; className?: string }) {
  const text = children.replace(/^\n+|\s+$/g, "")
  return (
    <figure className={cn("docs-code not-prose", className)}>
      <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b px-4 py-1.5">
        <span className="mono-comment truncate text-xs">{label}</span>
        {copy !== false && <CopyButton text={copy ?? text} className="js-only" ariaLabel={`Copy: ${label}`} />}
      </figcaption>
      <pre tabIndex={0} className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <code>{text}</code>
      </pre>
    </figure>
  )
}

/** A short aside. `tone="note"` for context, `"warn"` for something that can cost you data or time. */
export function Callout({ title, tone = "note", children }: { title?: string; tone?: "note" | "warn"; children: React.ReactNode }) {
  return (
    <aside className={cn("docs-callout", tone === "warn" && "docs-callout-warn")}>
      {title && <p className="font-semibold text-foreground">{title}</p>}
      <div className="flex flex-col gap-2">{children}</div>
    </aside>
  )
}

/** A table. At phone width each row becomes a small block with its column names (globals.css), so nothing scrolls sideways. */
export function Table({ head, rows, caption }: { head: React.ReactNode[]; rows: React.ReactNode[][]; caption?: string }) {
  return (
    <div className="docs-table" role="region" aria-label={caption ?? "Table"} tabIndex={0}>
      <table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={c} data-label={typeof head[c] === "string" ? head[c] : undefined}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A picture from the sample report, with a caption that says it is invented data. */
export function Shot({ src, alt, caption, width, height }: { src: string; alt: string; caption: string; width: number; height: number }) {
  return (
    <figure className="docs-shot not-prose">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static file from public/, served as is */}
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
      <figcaption>{caption}</figcaption>
    </figure>
  )
}
