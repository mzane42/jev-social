import { createBrowserRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/AppShell'
import { Home, NotFound } from '@/pages/Home'
import { AccountPage } from '@/pages/AccountPage'
import { NichePage } from '@/pages/NichePage'
import { RadarPage } from '@/pages/RadarPage'

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'n/:niche', element: <NichePage /> },
      { path: 'n/:niche/a/:account', element: <AccountPage /> },
      { path: 'radar', element: <RadarPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return (
    <TooltipProvider delayDuration={150}>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}
