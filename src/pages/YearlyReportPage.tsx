import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { fmtHoursMin, fmtNum, fmtVolume } from '@/lib/util'
import { SPORT_META } from '@/db/models'
import { buildYearlyReport, type YearlyReport } from '@/services/reports'
import { toDisplayWeight } from '@/services/calc'
import { Button, Card, PageHeader, SectionTitle } from '@/components/ui/basic'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'
import { BarsChart } from '@/components/charts/charts'
import { AIAnalysisSheet } from './MonthlyReportPage'
import { Sparkles } from 'lucide-react'
import { useSettings } from '@/store/settings'

/** 年度报告:年初 vs 年末、训练天数、最常训练部位、进步最大动作 */
export default function YearlyReportPage() {
  const { year = '2026' } = useParams()
  const navigate = useNavigate()
  const { unit } = useSettings()
  const [report, setReport] = useState<YearlyReport | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const y = parseInt(year, 10)

  useEffect(() => {
    buildYearlyReport(y).then(setReport)
  }, [y])

  if (!report) {
    return (
      <div className="min-h-dvh bg-bg pb-28">
        <PageHeader title={`我的${y}`} subtitle="年度数据生成中…" />
        <div className="mx-auto max-w-2xl px-4">
          <div className="skeleton h-48 rounded-3xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate('/reports')} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-[17px] font-semibold">我的{y}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 pt-4">
        {!report.hasData ? (
          <Card className="!p-8 text-center">
            <div className="mb-2 text-3xl">🌱</div>
            <p className="font-semibold">{y} 年还没有训练记录</p>
            <p className="mt-1 text-sm text-ink-3">坚持记录,年底这里会呈现你一整年的成长。</p>
          </Card>
        ) : (
          <>
            {/* 年度总览 */}
            <Card className={WM_PANEL + " !p-5"}>
              <BrandWatermark size="sm" pos="bl" opacity="opacity-[0.028]" />
              <SectionTitle title="年度总览" />
              <div className="grid grid-cols-3 gap-y-4 text-center">
                <Stat label="训练天数" value={`${report.totalSessions}`} />
                <Stat label="总组数" value={fmtNum(report.totalSets)} />
                <Stat label="总训练量" value={fmtVolume(report.totalVolume)} />
                <Stat label="主动休息" value={`${report.restDays}`} sub="天" />
                <Stat label="PR 刷新" value={`${report.prCount}`} sub="次" />
                <Stat
                  label="最常训练"
                  value={report.mostTrainedPart?.name ?? '—'}
                  sub={report.mostTrainedPart ? `${report.mostTrainedPart.count} 次` : ''}
                />
              </div>
            </Card>

            {/* 运动概览 */}
            {report.activity.count > 0 && (
              <Card className="!p-5">
                <SectionTitle title="运动概览" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="力量训练" value={`${report.totalSessions}`} sub="次" />
                  {Object.entries(report.activity.bySport).map(([sp, per]) => {
                    const meta = SPORT_META[sp as keyof typeof SPORT_META]
                    return <Stat key={sp} label={meta?.name ?? sp} value={`${per.count}`} sub="次" />
                  })}
                  <Stat label="运动时长" value={fmtHoursMin(report.activity.minutes)} sub="" />
                </div>
              </Card>
            )}

            {/* 月度节奏 */}
            <Card>
              <SectionTitle title="全年节奏" />
              <BarsChart
                data={report.monthlySessions.map((m) => ({ x: `${parseInt(m.month.slice(5), 10)}月`, y: m.sessions }))}
                height={150}
              />
            </Card>

            {/* 年初 vs 年末 —— 长期力量成长 */}
            {report.topProgress.length > 0 && (
              <Card className="!p-5">
                <SectionTitle title="年初 vs 年末 · 力量成长" />
                <div className="space-y-3">
                  {report.topProgress.map((p, i) => (
                    <div key={p.exerciseName + i} className="rounded-2xl bg-surface-2 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{p.exerciseName}</span>
                        {p.delta > 0 && (
                          <span className="num font-bold text-grow">
                            +{toDisplayWeight(p.delta, unit).toFixed(1)}{unit}
                          </span>
                        )}
                      </div>
                      <div className="num mt-1 flex items-center gap-2 text-[13px] text-ink-3">
                        <span>{p.start}</span>
                        <span>→</span>
                        <span className="font-semibold text-ink">{p.end}</span>
                        {p.pct > 0 && <span className="text-grow/80">↑{p.pct}%</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Button block size="lg" variant="secondary" onClick={() => setAiOpen(true)}>
              <Sparkles size={17} className="text-accent" /> AI 深度分析年度数据
            </Button>
          </>
        )}
      </main>

      {report && <AIAnalysisSheet open={aiOpen} onClose={() => setAiOpen(false)} kind="year" period={String(y)} report={report} />}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-xl font-bold">{value}</div>
      {sub && <div className="text-[10px] text-ink-3">{sub}</div>}
    </div>
  )
}
