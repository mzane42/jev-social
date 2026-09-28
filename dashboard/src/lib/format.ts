export const NA = 'n/a'

const isNum = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

export function fmtCompact(n: number | null | undefined): string {
  if (!isNum(n)) return NA
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: n < 1000 ? 0 : 1 }).format(n)
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (!isNum(n)) return NA
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtRatio(n: number | null | undefined, digits = 2): string {
  if (!isNum(n)) return NA
  // Keep small ratios readable instead of collapsing to 0.0×.
  const d = n !== 0 && Math.abs(n) < 0.1 ? Math.max(digits, 2) : digits
  return `${n.toFixed(d)}×`
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (!isNum(n)) return NA
  return n.toFixed(digits)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return NA
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NA
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** `tiktok@handle` -> { platform, handle } */
export function splitAccount(account: string): { platform: string; handle: string } {
  const at = account.indexOf('@')
  return at < 0 ? { platform: '', handle: account } : { platform: account.slice(0, at), handle: account.slice(at + 1) }
}

export { isNum }
