import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, BarChart3, Trophy, CalendarRange } from 'lucide-react'
import { db } from '@/db/db'
import { getReportMonths } from '@/services/reports'
import { fmtMonthCN, todayStr } from '@/lib/util'
import { Card, PageHeader, SectionTitle } from '@/components/ui/basic'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'

/** 报告中心:月度报告历史 + 年度报告 + 里程碑入口 */
export default function ReportsPage() {
  const navigate = useNavigate()
  const months = useLiveQuery(() => getReportMonths(), [], undefined)
  const year = new Date().getFullYear()

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <PageHeader title="报告" subtitle="月度复盘 · 年度成长 · 里程碑" />

      <BrandWatermark size="page" pos="tl" />
      <main className="mx-auto max-w-2xl space-y-5 px-4">
        {/* 年度 & 里程碑 */}
        <div className="grid grid-cols-2 gap-3">
          <Card onClick={() => navigate(`/report/year/${year}`)} className={WM_PANEL + " !p-4"}>
            <BrandWatermark size="sm" pos="tr" opacity="opacity-[0.035]" />
            <span className="flex size-10 items-center justify-center rounded-2xl bg-accent-dim text-accent">
              <CalendarRange size={19} />
            </span>
            <div className="mt-2.5 font-semibold">我的{year}</div>
            <div className="mt-0.5 text-xs text-ink-3">年度报告 · 年初 vs 年末</div>
          </Card>
          <Card onClick={() => navigate('/milestones')} className="!p-4">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-pr/15 text-pr">
              <Trophy size={19} />
            </span>
            <div className="mt-2.5 font-semibold">里程碑</div>
            <div className="mt-0.5 text-xs text-ink-3">第一次训练到突破 100kg</div>
          </Card>
        </div>

        {/* 月度报告列表 */}
        <div>
          <SectionTitle title="月度报告" />
          <div className="space-y-2">
            {months === undefined && <div className="skeleton h-40 rounded-3xl" />}
            {months !== undefined && months.length === 0 && (
              <Card className="text-sm text-ink-3">完成第一次训练后,每月自动生成训练报告。</Card>
            )}
            {months?.map((m) => (
              <MonthReportRow key={m} month={m} onClick={() => navigate(`/report/month/${m}`)} />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

function MonthReportRow({ month, onClick }: { month: string; onClick: () => void }) {
  const isCurrent = month === todayStr().slice(0, 7)
  // 月度速览数字
  const summary = useLiveQuery(async () => {
    const [y, m] = month.split('-').map(Number)
    const start = `${month}-01`
    const end = new Date(y, m, 0)
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    const sessions = await db.sessions
      .where('date')
      .between(start, endStr, true, true)
      .and((s) => s.status === 'completed')
      .count()
    const sets = await db.sets.where('date').between(start, endStr, true, true).count()
    return { sessions, sets }
  }, [month], undefined)

  return (
    <Card onClick={onClick} className="!p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">
          <BarChart3 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold">
            {fmtMonthCN(month)}
            {isCurrent && <span className="rounded-full bg-accent-dim px-2 py-0.5 text-[10px] font-medium text-accent">进行中</span>}
          </div>
          <div className="num mt-0.5 text-xs text-ink-3">
            {summary ? `${summary.sessions} 次训练 · ${summary.sets} 组` : '…'}
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-ink-3" />
      </div>
    </Card>
  )
}
