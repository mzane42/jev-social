import { useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { Chip, EmptyState, ExtLink, Panel, SectionTitle, Warning } from '@/components/kit'
import { IntentScatter, ProductLines, RisingBars, YieldBars } from '@/components/shop-charts'
import { fmtCompact, fmtDate, fmtPct, isNum, NA } from '@/lib/format'
import { cn } from '@/lib/utils'

/** TikTok Shop watch: products rising on TikTok Shop FR, from the `shop_*` tables (`/api/shop`). */

interface Product {
  productId: string
  title: string
  shortTitle: string
  url: string
  coverUrl: string | null
  sellerId: string | null
  categories: string[]
  skuCount: number | null
  firstSeen: string
  videos: number
  creators: number
  series: { date: string; views: number; videos: number }[]
}
interface Video {
  url: string
  handle: string
  productId: string | null
  isEc: number
  caption: string
  createdAt: string | null
  mode: string
  query: string
  firstSeen: string
  date: string
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
}
interface Creator {
  handle: string
  displayName: string | null
  followers: number | null
  videos: number
  shopVideos: number
  products: number
  medianViews: number | null
}
interface Query {
  mode: string
  query: string
  videos: number
  withProduct: number
  shop: number
}
interface Shop {
  dates: string[]
  videos: Video[]
  products: Product[]
  creators: Creator[]
  queries: Query[]
  day: { date: string; runAt: string; niche: string; errors: string[]; partial: string[]; usage?: { searches: number; details: number } } | null
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
const name = (p: Product) => p.shortTitle || p.title

export function ShopPage() {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/shop')
      .then((r) => (r.ok ? r.json() : null))
      .then(setShop, () => setShop(null))
  }, [])

  if (shop === undefined) return <p className="text-sm text-dim">Loading shop…</p>
  if (!shop || !shop.dates.length) {
    return (
      <EmptyState
        icon={<ShoppingBag className="size-5" aria-hidden />}
        title="No collection yet"
        body={
          <>
            Run <code className="num text-fg">jev-social shop collect --niche tiktok-shop-fr</code> then reload.
          </>
        }
      />
    )
  }

  const latest = shop.dates.at(-1)!
  const prev = shop.dates.at(-2) ?? null
  const byId = new Map(shop.products.map((p) => [p.productId, p]))
  const today = shop.videos.filter((v) => v.date === latest)
  const shopToday = today.filter((v) => v.isEc === 1 || v.productId)
  const newProducts = shop.products.filter((p) => p.firstSeen.slice(0, 10) === latest)
  const saveRates = shopToday.filter((v) => isNum(v.views) && v.views > 0 && isNum(v.saves)).map((v) => (v.saves as number) / (v.views as number))

  // Rising: views delta vs the previous collection day; on the first day, the views themselves.
  const at = (p: Product, d: string | null) => (d ? (p.series.find((s) => s.date === d)?.views ?? 0) : 0)
  const rising = shop.products
    .map((p) => ({ productId: p.productId, label: name(p), value: prev ? at(p, latest) - at(p, prev) : at(p, latest), creators: p.creators, videos: p.videos }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
  const lines = [...shop.products]
    .sort((a, b) => at(b, latest) - at(a, latest))
    .slice(0, 5)
    .map((p) => ({ productId: p.productId, label: name(p), points: p.series.map((s) => ({ date: s.date, views: s.views })) }))
  const points = shop.videos
    .filter((v) => isNum(v.views) && isNum(v.saves))
    .map((v) => ({ url: v.url, handle: v.handle, views: v.views as number, saveRate: (v.saves as number) / Math.max(v.views as number, 1), isEc: v.isEc === 1 || Boolean(v.productId), product: v.productId ? name(byId.get(v.productId)!) : null }))
  const yieldRows = [...shop.queries].sort((a, b) => b.withProduct / Math.max(b.videos, 1) - a.withProduct / Math.max(a.videos, 1)).map((q) => ({ label: `${q.mode === 'creator' ? '@' : '#'}${q.query}`, videos: q.videos, withProduct: q.withProduct }))
  const creators = [...shop.creators].filter((c) => c.shopVideos > 0).sort((a, b) => b.shopVideos - a.shopVideos || (b.medianViews ?? 0) - (a.medianViews ?? 0)).slice(0, 15)
  const products = [...shop.products].sort((a, b) => at(b, latest) - at(a, latest))
  const videos = [...shop.videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  const errors = shop.day?.date === latest ? shop.day.errors.length : 0

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold sm:text-3xl">TikTok Shop</h1>
        <p className="max-w-2xl text-sm text-dim">
          Products tagged on TikTok videos found by the <code className="num text-fg">tiktok-shop-fr</code> watch. {shop.dates.length} collection day{shop.dates.length === 1 ? '' : 's'}, latest {fmtDate(latest)}. Price and sales are not in the page data.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Products tracked" value={String(shop.products.length)} />
        <Stat label="New today" value={String(newProducts.length)} hint={newProducts.length ? newProducts.slice(0, 2).map(name).join(' · ') : undefined} />
        <Stat label="Shop videos today" value={String(shopToday.length)} hint={`of ${today.length} read`} />
        <Stat label="Median save rate" value={fmtPct(median(saveRates), 2)} hint="saves / views, shop videos" />
        <Stat label="Creators with products" value={String(shop.creators.filter((c) => c.products > 0).length)} />
        <Stat label="Collection errors" value={String(errors)} cls={errors ? 'text-amber' : undefined} hint={shop.day?.usage ? `${shop.day.usage.searches} searches · ${shop.day.usage.details} reads` : undefined} />
      </dl>

      {shop.day?.date === latest && shop.day.errors.length ? <Warning>{shop.day.errors.slice(0, 3).join(' · ')}</Warning> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="space-y-3 p-4">
          <SectionTitle title="Rising products" hint={prev ? `Views gained since ${fmtDate(prev)}, across the videos that tag the product.` : 'Views of the videos that tag the product. The delta starts with the next collection day.'} />
          {rising.length ? <RisingBars rows={rising} /> : <EmptyState title="No product video yet" />}
        </Panel>
        <Panel className="space-y-3 p-4">
          <SectionTitle title="Purchase intent" hint="Each video by views and save rate. Product videos in violet. High and to the right = worth a look." />
          {points.length ? <IntentScatter points={points} /> : <EmptyState title="No video stats" />}
        </Panel>
        <Panel className="space-y-3 p-4">
          <SectionTitle title="Query yield" hint="Share of read videos that tag a product, per watched hashtag. Low yield = noise, change the niche config." />
          {yieldRows.length ? <YieldBars rows={yieldRows} /> : <EmptyState title="No query" />}
        </Panel>
        <Panel className="space-y-3 p-4">
          <SectionTitle title="Top products over time" hint={shop.dates.length > 1 ? 'Views summed over each product’s videos, per collection day.' : 'Needs two collection days. Tomorrow.'} />
          {shop.dates.length > 1 && lines.length ? (
            <ProductLines lines={lines} dates={shop.dates} />
          ) : (
            <ul className="space-y-1 text-sm">
              {lines.map((l) => (
                <li key={l.productId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-fg">{l.label}</span>
                  <span className="num shrink-0 text-dim">{fmtCompact(l.points.at(-1)?.views ?? null)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="space-y-3">
        <SectionTitle title="Products" hint="Sorted by the views of the videos that tag them." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <Panel as="article" key={p.productId} className="flex gap-3 p-3">
              {p.coverUrl ? (
                <img src={p.coverUrl} alt="" width={64} height={64} loading="lazy" className="size-16 shrink-0 rounded-lg border border-line object-cover" />
              ) : (
                <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-dim">
                  <ShoppingBag className="size-5" aria-hidden />
                </div>
              )}
              <div className="min-w-0 space-y-1.5">
                <ExtLink href={p.url} className="line-clamp-2 text-sm font-medium">
                  {p.title}
                </ExtLink>
                <p className="truncate text-xs text-dim" title={p.categories.join(' › ')}>
                  {p.categories.join(' › ')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip className="num">{fmtCompact(at(p, latest))} views</Chip>
                  <Chip className="num">
                    {p.creators} creator{p.creators === 1 ? '' : 's'}
                  </Chip>
                  <Chip className="num">{p.skuCount ?? NA} SKU</Chip>
                  {p.firstSeen.slice(0, 10) === latest ? <Chip className="text-violet">new</Chip> : null}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Creators" hint="Accounts posting product videos, most active first. Candidates for the creator mode of the niche config." />
        <Panel className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-dim">
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-2 py-3 text-right font-medium">Shop videos</th>
                <th className="px-2 py-3 text-right font-medium">Products</th>
                <th className="px-2 py-3 text-right font-medium">Median views</th>
                <th className="px-4 py-3 text-right font-medium">Followers</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.handle} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                  <td className="whitespace-nowrap px-4 py-2">
                    <ExtLink href={`https://www.tiktok.com/@${c.handle}`}>@{c.handle}</ExtLink>
                  </td>
                  <td className="num px-2 py-2 text-right">{c.shopVideos}</td>
                  <td className="num px-2 py-2 text-right text-dim">{c.products}</td>
                  <td className="num px-2 py-2 text-right text-dim">{fmtCompact(c.medianViews)}</td>
                  <td className="num px-4 py-2 text-right text-dim">{fmtCompact(c.followers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Videos" hint="Every tracked video with its latest read, most viewed first." />
        <Panel className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-dim">
                <th className="px-4 py-3 text-right font-medium">Views</th>
                <th className="px-2 py-3 text-right font-medium">Saves</th>
                <th className="px-2 py-3 text-right font-medium">Save rate</th>
                <th className="px-2 py-3 font-medium">Account</th>
                <th className="px-2 py-3 font-medium">Product</th>
                <th className="px-2 py-3 font-medium">Query</th>
                <th className="px-2 py-3 font-medium">Read</th>
                <th className="px-4 py-3 font-medium">Caption</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <tr key={v.url} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                  <td className="num px-4 py-2 text-right">{fmtCompact(v.views)}</td>
                  <td className="num px-2 py-2 text-right text-dim">{fmtCompact(v.saves)}</td>
                  <td className="num px-2 py-2 text-right text-dim">{isNum(v.views) && v.views > 0 && isNum(v.saves) ? fmtPct(v.saves / v.views, 2) : NA}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <ExtLink href={v.url}>@{v.handle}</ExtLink>
                  </td>
                  <td className="max-w-[16rem] truncate px-2 py-2 text-xs" title={v.productId ? byId.get(v.productId)?.title : undefined}>
                    {v.productId ? name(byId.get(v.productId)!) : v.isEc ? <Chip>shop</Chip> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-dim">
                    {v.mode} · #{v.query}
                  </td>
                  <td className="num whitespace-nowrap px-2 py-2 text-xs text-dim">{v.date.slice(5)}</td>
                  <td className="max-w-[24rem] truncate px-4 py-2 text-xs text-dim" title={v.caption}>
                    {v.caption}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  )
}

function Stat({ label, value, hint, cls }: { label: string; value: string; hint?: string; cls?: string }) {
  return (
    <Panel as="div" className="p-3">
      <dt className="text-[11px] text-dim">{label}</dt>
      <dd className={cn('mt-0.5 text-2xl font-semibold', value === NA ? 'text-dim' : (cls ?? 'text-fg'))}>{value}</dd>
      {hint ? <dd className="mt-0.5 truncate text-[11px] text-dim">{hint}</dd> : null}
    </Panel>
  )
}
