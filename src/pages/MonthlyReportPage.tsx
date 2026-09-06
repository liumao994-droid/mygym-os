import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { fmtHoursMin, fmtMonthCN, fmtVolume } from '@/lib/util'
import { buildMonthlyReport, type MonthlyReport } from '@/services/reports'
import { generateAIAnalysis, getCachedAIAnalysis } from '@/services/ai'
import { toDisplayWeight } from '@/services/calc'
import { Button, Card, PageHeader, SectionTitle, Sheet } from '@/components/ui/basic'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'
import { DonutChart, BarsChart } from '@/components/charts/charts'
import { useSettings } from '@/store/settings'

/** 月度训练报告:总结 / 力量进步领奖台 / PR / 平衡 / 表现叙述 / AI 深度分析 */
export default function MonthlyReportPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const { unit } = useSettings()
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    buildMonthlyReport(key).then(setReport)
  }, [key])

  if (!report) {
    return (
      <div className="min-h-dvh bg-bg pb-28">
        <PageHeader title={fmtMonthCN(key)} subtitle="训练报告生成中…" />
        <div className="mx-auto max-w-2xl space-y-3 px-4">
          <div className="skeleton h-32 rounded-3xl" />
          <div className="skeleton h-48 rounded-3xl" />
        </div>
      </div>
    )
  }

  const s = report.summary
  const conv = (kg: number) => {
    const v = toDisplayWeight(kg, unit)
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  return (
    <div className="min-h-dvh bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate('/reports')} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <div>
            <h1 className="text-[17px] font-semibold">{fmtMonthCN(key)}训练报告</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 pt-4">
        {/* 本月总结 */}
        <Card className={WM_PANEL + " !p-5"}>
          <BrandWatermark size="sm" pos="tl" opacity="opacity-[0.028]" />
          <SectionTitle title="本月总结" />
          <div className="grid grid-cols-3 gap-y-4 text-center">
            <Stat label="训练" value={`${s.trained}`} sub="天" />
            <Stat label="休息" value={`${s.rest}`} sub="天" />
            <Stat label="未记录" value={`${s.unrecorded}`} sub="天" />
            <Stat label="总动作" value={`${s.totalExercises}`} sub="个动作条目" />
            <Stat label="总组数" value={`${s.totalSets}`} sub="组" />
            <Stat label="训练量" value={fmtVolume(s.totalVolume)} sub="" />
          </div>
          {s.trained > 0 && (
            <div className="num mt-4 flex justify-around rounded-2xl bg-surface-2 py-2.5 text-center text-xs text-ink-3">
              <span>周均 {s.weeklyAvg.toFixed(1)} 次</span>
              <span>均每次 {(s.avgExercisesPerSession).toFixed(1)} 动作</span>
              <span>均每次 {(s.avgSetsPerSession).toFixed(1)} 组</span>
            </div>
          )}
        </Card>

        {/* 运动概览(羽毛球等,与力量统计分开) */}
        {report.activity.count > 0 && (
          <Card className="!p-5">
            <SectionTitle title="运动概览" />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xl">🏋️</div>
                <div className="num mt-1 text-lg font-bold">{s.trained}</div>
                <div className="text-[10px] text-ink-3">力量训练 次</div>
              </div>
              <div>
                <div className="text-xl">🏸</div>
                <div className="num mt-1 text-lg font-bold">{report.activity.count}</div>
                <div className="text-[10px] text-ink-3">羽毛球 次</div>
              </div>
              <div>
                <div className="text-xl">⏱</div>
                <div className="num mt-1 text-lg font-bold">{fmtHoursMin(report.activity.minutes)}</div>
                <div className="text-[10px] text-ink-3">运动时长</div>
              </div>
            </div>
          </Card>
        )}

        {/* 周分布 */}
        {s.trained > 0 && (
          <Card>
            <SectionTitle title="每周节奏" />
            <BarsChart data={report.weeklyBars.map((w) => ({ x: w.label, y: w.sessions }))} height={140} />
          </Card>
        )}

        {/* 力量进步领奖台 */}
        {report.podium.length > 0 && (
          <Card className="!p-5">
            <SectionTitle title="月度力量进步" />
            <div className="space-y-2.5">
              {report.podium.map((p, i) => (
                <motion.div
                  key={p.exerciseId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3"
                >
                  <span className="text-xl">{['🥇', '🥈', '🥉'][i]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{p.exerciseName}</div>
                    <div className="num text-xs text-ink-3">
                      {conv(p.lastMonth.weight)}kg × {p.lastMonth.reps} → {conv(p.thisMonth.weight)}kg × {p.thisMonth.reps}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num font-bold text-grow">
                      +{toDisplayWeight(p.weightDelta, unit).toFixed(1)}{unit}
                    </div>
                    <div className="num text-[11px] text-grow/80">1RM {p.pctChange > 0 ? '+' : ''}{p.pctChange}%</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Card>
        )}

        {/* 本月 PR */}
        {report.monthPRs.length > 0 && (
          <Card className="!p-5">
            <SectionTitle title="本月 PR" />
            <div className="space-y-2">
              {report.monthPRs.slice(0, 6).map((pr) => (
                <div key={pr.exerciseId} className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-2.5">
                  <span className="text-[14px] font-medium">{pr.exerciseName}</span>
                  <span className="num text-[14px] font-bold text-pr">
                    {pr.weight > 0 ? `${conv(pr.weight)}kg × ${pr.reps}` : `${pr.reps} 次`}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 训练分布 */}
        <Card className="!p-5">
          <SectionTitle title="本月训练分布" />
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <DonutChart
              data={report.parts.map((p) => ({ name: p.name, value: p.sessions, color: p.color }))}
              height={190}
              centerValue={`${s.trained}`}
              centerLabel="训练天数"
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5">
            {report.parts.map((p) => (
              <div key={p.part} className="flex items-center gap-1.5 text-xs">
                <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-ink-2">{p.name}</span>
                <span className="num ml-auto text-ink-3">{p.sessions}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* 平衡 */}
        {s.trained > 0 && report.balance.most && (
          <Card className="!p-5">
            <SectionTitle title="训练平衡" />
            <p className="text-[15px] leading-relaxed text-ink-2">
              从记录来看,本月 <b className="text-ink">{report.balance.most.name}</b> 部训练次数最高(
              {report.balance.most.count} 次),
              <b className="text-ink">{report.balance.least?.name}</b> 部最少({report.balance.least?.count ?? 0} 次)。
            </p>
          </Card>
        )}

        {/* 表现叙述 */}
        <Card className="!p-5">
          <SectionTitle title="本月表现" />
          <div className="space-y-2">
            {report.performanceText.map((t, i) => (
              <p key={i} className="text-[15px] leading-relaxed text-ink-2">{t}</p>
            ))}
          </div>
          {report.focusText.length > 0 && (
            <>
              <SectionTitle title="下个月可以关注" />
              <div className="space-y-2">
                {report.focusText.map((t, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-ink-2">· {t}</p>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* AI 深度分析 */}
        <Button block size="lg" variant="secondary" onClick={() => setAiOpen(true)}>
          <Sparkles size={17} className="text-accent" /> AI 深度分析本月数据
        </Button>
      </main>

      <AIAnalysisSheet open={aiOpen} onClose={() => setAiOpen(false)} kind="month" period={key} report={report} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-xl font-bold">{value}</div>
      {sub && <div className="text-[10px] text-ink-3">{sub}</div>}
    </div>
  )
}

/* =============== AI 深度分析(主动触发 + 缓存) =============== */

export function AIAnalysisSheet({
  open,
  onClose,
  kind,
  period,
  report,
}: {
  open: boolean
  onClose: () => void
  kind: 'month' | 'year'
  period: string
  report: MonthlyReport | import('@/services/reports').YearlyReport
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cached = useLiveQuery(() => getCachedAIAnalysis(kind, period), [kind, period, open], undefined)

  useEffect(() => {
    if (open) {
      setContent(null)
      setError(null)
      setLoading(false)
    }
  }, [open])

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const text = await generateAIAnalysis(kind, period, report)
      setContent(text)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg === 'AI_NOT_CONFIGURED' ? '尚未配置 AI 服务' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="AI 深度分析">
      <div className="space-y-4 pb-6">
        <p className="text-xs leading-relaxed text-ink-3">
          仅在你主动点击时调用一次 AI 接口,结果会缓存;基础统计全部来自本地数据库,AI 不编造数据。
        </p>

        {content ? (
          <Card className="whitespace-pre-wrap text-[14px] leading-relaxed">{content}</Card>
        ) : cached ? (
          <>
            <Card className="whitespace-pre-wrap text-[14px] leading-relaxed">{cached}</Card>
            <Button variant="secondary" block loading={loading} onClick={handleGenerate}>
              重新生成
            </Button>
          </>
        ) : (
          <>
            {error && (
              <Card className="!bg-warn/[0.08] text-[13px] leading-relaxed text-warn ring-warn/25">
                {error}
                {error === '尚未配置 AI 服务' && (
                  <span className="mt-1 block text-ink-3">在「我的 → AI 分析设置」中填入 OpenAI 兼容接口的地址、Key 与模型名即可使用。没有配置也不影响任何本地功能。</span>
                )}
              </Card>
            )}
            <Button block size="lg" loading={loading} onClick={handleGenerate}>
              {loading ? '分析中…' : '生成分析(调用一次 AI)'}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  )
}
