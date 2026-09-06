import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getMilestones } from '@/services/insights'
import { fmtDateFullCN } from '@/lib/util'
import { Card, SectionTitle } from '@/components/ui/basic'
import { BrandWatermark } from '@/components/BrandWatermark'

/** 里程碑:训练次数 / 累计吨位 / 动作重量突破 / PR 次数 + 下一个目标 */
export default function MilestonesPage() {
  const navigate = useNavigate()
  const data = useLiveQuery(() => getMilestones(), [], undefined)

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate('/reports')} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-[17px] font-semibold">里程碑</h1>
        </div>
      </header>

      <BrandWatermark size="page" pos="br" />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {data === undefined && <div className="skeleton h-64 rounded-3xl" />}

        {data !== undefined && data.achieved.length === 0 && (
          <Card className="!p-8 text-center">
            <div className="mb-2 text-3xl">🏁</div>
            <p className="font-semibold">还没有解锁里程碑</p>
            <p className="mt-1 text-sm text-ink-3">第一次训练、第一个 PR……都从这里开始。</p>
          </Card>
        )}

        {data !== undefined && data.next.length > 0 && (
          <Card className="!p-5 !bg-accent-dim ring-accent/25">
            <SectionTitle title="下一个目标" />
            <div className="space-y-1.5">
              {data.next.map((n, i) => (
                <p key={i} className="num text-[14px] font-medium text-ink-2">
                  · {n}
                </p>
              ))}
            </div>
          </Card>
        )}

        <div className="space-y-2">
          {data?.achieved.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.3 }}
              className="flex items-center gap-3.5 rounded-3xl bg-surface p-4 ring-1 ring-line"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-pr/12 text-2xl">{m.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{m.title}</div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {m.detail} · {fmtDateFullCN(m.achievedAt)}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  )
}
