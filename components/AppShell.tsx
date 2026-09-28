'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  ['/dashboard', 'Dashboard'],
  ['/workouts', 'Workouts'],
  ['/bodyweight', 'Bodyweight'],
  ['/exercises', 'Exercises'],
  ['/analytics', 'Analytics'],
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const navLinks = nav.map(([href, label]) => (
    <Link key={href} href={href} className={pathname === href ? 'active' : ''}>
      <span className="nav-item-label">{label}</span>
    </Link>
  ))

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-dot" /> Progress Forge
        </Link>
        <nav className="nav">{navLinks}</nav>
        <div className="sidebar-footer">
          <div className="card-soft muted" style={{ fontSize: 12 }}>
            <span className="live-dot" />Cloud sync enabled
          </div>
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost" style={{ width: '100%' }}>Sign out</button>
          </form>
        </div>
      </aside>
      <main className="app-main">
        <nav className="mobile-nav">{navLinks}</nav>
        {children}
      </main>
    </div>
  )
}
