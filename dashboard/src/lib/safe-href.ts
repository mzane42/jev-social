const ALLOWED_HOSTS = ['tiktok.com', 'instagram.com']

/** Returns the URL only when it is https: on tiktok.com / instagram.com (or a subdomain). */
export function safeHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? url.href : null
}
