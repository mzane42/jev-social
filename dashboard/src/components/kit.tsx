import type { ReactNode } from 'react'
import { ExternalLink, FlaskConical, Inbox, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-href'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Confidence } from '@/types'

/** Card surface: 16px radius, 1px line border, no shadow. */
export function Panel({ className, children, as: Tag = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cn('min-w-0 overflow-hidden rounded-2xl border border-line bg-surface', className)}>{children}</Tag>
}

export function SectionTitle({ title, hint, right, className }: { title: ReactNode; hint?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-dim">{hint}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  )
}

export function MockBadge({ className, label = 'mock data' }: { className?: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 text-[11px] font-medium text-amber',
            className,
          )}
        >
          <FlaskConical className="size-3" aria-hidden />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>Placeholder values. The analyzer does not produce this yet.</TooltipContent>
    </Tooltip>
  )
}

const PLATFORM_STYLE: Record<string, { label: string; cls: string }> = {
  tiktok: { label: 'TikTok', cls: 'border-cyan/40 bg-cyan/10 text-cyan' },
  instagram: { label: 'Instagram', cls: 'border-violet/40 bg-violet/10 text-violet' },
}

export function PlatformPill({ platform, short, className }: { platform: string; short?: boolean; className?: string }) {
  const s = PLATFORM_STYLE[platform] ?? { label: platform || 'unknown', cls: 'border-line bg-surface-2 text-dim' }
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium', s.cls, className)}>
      {short ? (platform === 'tiktok' ? 'TT' : platform === 'instagram' ? 'IG' : s.label.slice(0, 2).toUpperCase()) : s.label}
    </span>
  )
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 max-w-full shrink-0 items-center truncate rounded-md border border-line bg-surface-2 px-1.5 text-[11px] text-fg/85', className)}>
      {children}
    </span>
  )
}

/** Renders an <a> only for https TikTok/Instagram URLs; otherwise plain text. */
export function ExtLink({ href, children, className, iconOnly }: { href: string | null | undefined; children?: ReactNode; className?: string; iconOnly?: boolean }) {
  const safe = safeHref(href)
  const content = iconOnly ? <ExternalLink className="size-3.5" aria-hidden /> : children
  if (!safe) return <span className={cn('text-dim', className)}>{iconOnly ? '—' : children}</span>
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={iconOnly ? 'Open on platform' : undefined}
      className={cn('inline-flex items-center gap-1 text-cyan underline-offset-4 transition-colors hover:text-fg hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-violet', className)}
    >
      {content}
    </a>
  )
}

export function EmptyState({ title, body, icon, className }: { title: string; body?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <div className="grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-dim">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <p className="font-medium text-fg">{title}</p>
      {body ? <p className="max-w-sm text-sm text-dim">{body}</p> : null}
    </div>
  )
}

export function Warning({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn('flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/5 px-3 py-2 text-sm text-amber', className)}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

const CONF: Record<Confidence, string> = { low: 'bg-amber', medium: 'bg-violet', high: 'bg-good' }

export function ConfidenceTag({ value }: { value: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-dim">
      <span className={cn('size-1.5 rounded-full', CONF[value])} aria-hidden />
      {value} conf.
    </span>
  )
}

export function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-dim">{label}</span>
        <span className="num text-fg">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  )
}
