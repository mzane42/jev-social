import { Navigate } from 'react-router'
import { FolderOpen } from 'lucide-react'
import { EmptyState, Panel } from '@/components/kit'
import { useShell } from '@/components/AppShell'

export function Home() {
  const { niches } = useShell()
  if (niches.length) return <Navigate to={`/n/${encodeURIComponent(niches[0].niche)}`} replace />
  return (
    <Panel className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<FolderOpen className="size-5" aria-hidden />}
        title="No reports found"
        body={
          <>
            Run <code className="num text-fg">jev-social profile</code> to capture an account, or point{' '}
            <code className="num text-fg">JEV_SOCIAL_REPORTS_DIR</code> at a reports folder.
          </>
        }
      />
    </Panel>
  )
}

export function NotFound({ what = 'Page' }: { what?: string }) {
  return (
    <Panel className="mx-auto mt-10 max-w-lg">
      <EmptyState title={`${what} not found`} body="It may have been removed, or the link is wrong. Pick one from the sidebar." />
    </Panel>
  )
}
