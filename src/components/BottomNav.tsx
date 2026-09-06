import { NavLink, useLocation } from 'react-router-dom'
import { House, Dumbbell, History, User } from 'lucide-react'
import { cn } from '@/lib/util'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'

const TABS = [
  { to: '/', label: '首页', icon: House },
  { to: '/train', label: '训练', icon: Dumbbell, accent: true },
  { to: '/history', label: '历史', icon: History },
  { to: '/me', label: '我的', icon: User },
]

export function BottomNav() {
  const location = useLocation()
  // 训练进行中:训练 tab 显示呼吸点
  const activeSession = useLiveQuery(async () => {
    const rows = await db.sessions.where('status').equals('active').toArray()
    return rows[0]
  }, [])
  const training = activeSession || location.pathname.startsWith('/workout/')

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[var(--nav-blur)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl items-stretch justify-around px-2 pt-1.5">
        {TABS.map((t) => {
          const Icon = t.icon
          const isTrain = t.to === '/train'
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex min-w-16 flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 transition-colors',
                  isActive ? 'text-ink' : 'text-ink-3',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon size={22} strokeWidth={isActive ? 2.4 : 2} className={cn(isTrain && training && 'text-accent')} />
                    {isTrain && training && (
                      <span className="absolute -right-1 -top-0.5 size-2 animate-pulse rounded-full bg-accent" />
                    )}
                  </span>
                  <span className={cn('text-[10px] font-medium', isTrain && 'text-accent')}>{t.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
