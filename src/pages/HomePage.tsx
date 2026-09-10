import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Play, Copy, Moon, CalendarDays, Flame } from 'lucide-react'
import { db } from '@/db/db'
import { copyLastSession, markRest, startSession } from '@/services/repo'
import { getHomeStats, getPartDistribution, getTodayState } from '@/services/stats'
import { getRecentPREvents } from '@/services/pr'
import { getInsights, dismissInsight, type Insight } from '@/services/insights'
import { cn, fmtDateCN, fmtDateFullCN, fmtHoursMin, fmtVolume, fmtWeekdayCN, fmtWeight, haptic, todayStr, addDays } from '@/lib/util'
import { toDisplayWeight } from '@/services/calc'
import { Button, Card, EmptyState, SectionTitle, Sheet } from '@/components/ui/basic'
import { SPORT_META, SPORT_TYPES } from '@/db/models'
import { toast, useSettings } from '@/store/settings'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'

/** 首页:今日状态 → 核心数据 → 最近进步 → 快捷入口 → 洞察 */
export default function HomePage() {
  const navigate = useNavigate()
  const [sportSheetOpen, setSportSheetOpen] = useState(false)
  const { unit, remindersEnabled } = useSettings()
  const today = todayStr()

  const todayState = useLiveQuery(() => getTodayState(today), [today], undefined)
  const stats = useLiveQuery(() => getHomeStats(), [], undefined)
  const activityCount = useLiveQuery(() => db.activitySessions.count(), [], undefined)
  const exerciseNames = useLiveQuery(() => db.exercises.toArray(), [], [])
  const exNameMap = useMemo(() => new Map((exerciseNames ?? []).map((e) => [e.id, e.name])), [exerciseNames])

  const progress = useLiveQuery(async () => {
    const events = await getRecentPREvents(30)
    // 每动作只保留最显著的一条(est1rm 优先)
    const best = new Map<string, { name: string; text: string; delta: number; pct: number; type: string }>()
    for (const e of events) {
      const name = exNameMap.get(e.exerciseId)
      if (!name) continue
      const dispW = e.weight > 0 ? `${fmtWeight(Math.round(toDisplayWeight(Math.abs(e.weight), unit) * 100) / 100)}${unit}` : e.weightType === 'assisted' ? `-${fmtWeight(Math.abs(e.weight))}${unit}` : null
      const cur = best.get(e.exerciseId)
      const delta = e.prevValue !== null ? e.value - e.prevValue : 0
      const pctChange = e.prevValue ? (delta / e.prevValue) * 100 : 0
      const item = {
        name,
        text: e.type === 'maxReps' ? `${dispW ?? ''} × ${e.reps}次` : `${dispW ?? ''} × ${e.reps}`,
        delta: e.type === 'est1rm' ? delta : e.type === 'maxWeight' ? delta : 0,
        pct: e.type === 'est1rm' ? pctChange : 0,
        type: e.type,
      }
      const score = item.delta + item.pct
      const curScore = cur ? cur.delta + cur.pct : -1
      if (!cur || score > curScore) best.set(e.exerciseId, item)
    }
    return [...best.values()].sort((a, b) => b.delta - a.delta).slice(0, 3)
  }, [exerciseNames, unit], undefined)

  const insights = useLiveQuery(
    () => getInsights({ remindersEnabled }),
    [remindersEnabled, today],
    undefined,
  )

  // 空状态:完全没有训练记录
  const isEmpty = stats !== undefined && activityCount !== undefined && stats.totalSessions === 0 && activityCount === 0 && !todayState?.session

  const suffix = useMemo(() => {
    const h = new Date().getHours()
    return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  }, [])

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      {/* 问候 + 日期 */}
      <header className="safe-top px-5 pb-1 pt-6">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight">{suffix}</h1>
        <p className="mt-0.5 text-[15px] text-ink-3">
          今天 · {fmtDateFullCN(today)} · {fmtWeekdayCN(today)}
        </p>
      </header>

      <BrandWatermark />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pt-4">
        {/* 今日状态 */}
        <TodayCard state={todayState} />

        {/* 洞察/提醒卡片 */}
        {insights && insights.length > 0 && (
          <div className="space-y-2">
            {insights.map((ins) => (
              <InsightCard key={ins.id} insight={ins} onDismiss={() => dismissInsight(ins.id)} />
            ))}
          </div>
        )}

        {isEmpty ? (
          <Card className={WM_PANEL + " !bg-accent-dim ring-accent/30"}>
            <BrandWatermark size="hero" pos="br" opacity="opacity-[0.04]" />
            <EmptyState
              icon="💪"
              title="开始记录你的第一次训练"
              desc="选择部位、动作,输入重量和次数,剩下的交给 MyGym OS。"
              actionText="开始第一次训练"
              onAction={async () => {
                const s = await startSession(['back', 'biceps'])
                navigate(`/workout/${s.id}`)
              }}
            />
            <button
              onClick={() => {
                setSportSheetOpen(true)
              }}
              className="mt-1 rounded-xl px-4 py-2 text-[13px] font-medium text-ink-2 ring-1 ring-line"
            >
              或记录其他运动(游泳 / 网球…)
            </button>
            <button
              onClick={async () => {
                const { seedDemoData } = await import('@/services/seed')
                const n = await seedDemoData()
                toast(n > 0 ? `已生成 ${n} 次示例训练,可在设置中一键清除` : '已存在示例数据')
              }}
              className="w-full pb-2 text-center text-[13px] text-ink-3 underline-offset-4 hover:underline"
            >
              先看看示例数据(可随时一键清除)
            </button>
          </Card>
        ) : (
          <>
            {/* 核心数据 */}
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="本月训练"
                value={stats ? `${stats.monthSessions}` : '…'}
                unit="天"
                delay={0.05}
              />
              <StatTile label="本周训练" value={stats ? `${stats.weekSessions}` : '…'} unit="次" delay={0.08} />
              <StatTile
                label="总训练量"
                value={stats ? fmtVolume(stats.totalVolume) : '…'}
                className="col-span-2"
                delay={0.11}
              />
            </div>

            {/* 最近 7 天连续性(训练/休息/未记录 严格区分) */}
            <Card delay={0.14}>
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-medium text-ink-2">最近 7 天</h3>
                <span className="num text-xs text-ink-3">
                  {stats ? `训练 ${stats.last7Summary.trained} · 休息 ${stats.last7Summary.rest} · 未记录 ${stats.last7Summary.unrecorded}` : ''}
                </span>
              </div>
              <div className="mt-3 flex justify-between">
                {(stats?.last7 ?? []).map((d) => (
                  <div key={d.date} className="flex flex-col items-center gap-1.5">
                    <span className="text-[10px] text-ink-3">{fmtDateCN(d.date).replace(/月|日/g, '')}</span>
                    <motion.span
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-xl text-xs font-bold',
                        d.kind === 'trained' && 'bg-accent text-accent-ink',
                        d.kind === 'rest' && 'bg-rest/15 text-rest',
                        d.kind === 'unrecorded' && 'bg-surface-2 text-ink-3',
                      )}
                    >
                      {d.kind === 'trained' ? '练' : d.kind === 'rest' ? '休' : '·'}
                    </motion.span>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 flex gap-3 text-[10px] text-ink-3">
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />训练</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-rest" />主动休息</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-surface-3" />未记录</span>
              </div>
            </Card>

            {/* 最近进步 */}
            <div>
              <SectionTitle title="最近进步" />
              {progress === undefined ? (
                <div className="skeleton h-24" />
              ) : progress.length === 0 ? (
                <Card className="text-sm text-ink-3">最近 30 天暂有力量的变化记录,继续积累,进步会出现。</Card>
              ) : (
                <div className="space-y-2">
                  {progress.map((p, i) => (
                    <Card key={p.name} delay={0.05 * i} onClick={() => navigate('/history')}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{p.name}</div>
                          <div className="num mt-0.5 text-[13px] text-ink-3">{p.text}</div>
                        </div>
                        {p.delta > 0 && (
                          <div className="text-right">
                            <div className="num text-lg font-bold text-grow">
                              +{fmtWeight(Math.round(toDisplayWeight(p.delta, unit) * 10) / 10)}
                              {unit}
                            </div>
                            {p.pct > 0 && (
                              <div className="num text-xs text-grow/80">↑ 估算力量提升 {Math.round(p.pct)}%</div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* 本月部位分布(小条形) */}
            <MonthPartsCard />

            {/* 记录运动 */}
            <div>
              <SectionTitle title="记录运动" />
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                onClick={() => setSportSheetOpen(true)}
                className="flex w-full items-center gap-3 rounded-3xl bg-surface p-4 text-left ring-1 ring-line transition-transform active:scale-[0.99]"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-dim text-lg">🏃</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">记录一次运动</span>
                  <span className="block text-xs text-ink-3">{SPORT_TYPES.map((sp) => SPORT_META[sp].emoji + " " + SPORT_META[sp].name).join(" · ")}</span>
                </span>
                <span className="text-ink-3">›</span>
              </motion.button>
            </div>

            {/* 快捷入口 */}
            <div>
              <SectionTitle title="力量训练快捷入口" />
              <div className="grid grid-cols-2 gap-3">
                <QuickAction
                  icon={<Play size={17} />}
                  label="开始训练"
                  primary
                  onClick={async () => {
                    const s = await startSession(['back', 'biceps'])
                    haptic(15)
                    navigate(`/workout/${s.id}`)
                  }}
                />
                <QuickAction
                  icon={<Copy size={17} />}
                  label="复制上次训练"
                  onClick={async () => {
                    const res = await copyLastSession()
                    if (!res) return toast('还没有训练记录', 'error')
                    navigate(`/workout/${res.session.id}`)
                  }}
                />
                <QuickAction
                  icon={<Moon size={17} />}
                  label="记录休息"
                  onClick={async () => {
                    await markRest(today)
                    toast('已记录今天休息 🌙')
                  }}
                />
                <QuickAction icon={<CalendarDays size={17} />} label="查看本周" onClick={() => navigate('/history')} />
              </div>
            </div>
          </>
        )}
      </main>

      {/* 记录运动:选择运动类型 */}
      <Sheet open={sportSheetOpen} onClose={() => setSportSheetOpen(false)} title="选择运动类型">
        <div className="space-y-2.5 pb-6">
          {SPORT_TYPES.map((sp) => {
            const meta = SPORT_META[sp]
            return (
              <button
                key={sp}
                onClick={() => {
                  setSportSheetOpen(false)
                  navigate(meta.routeBase === '/train' ? '/train' : `${meta.routeBase}/new`)
                }}
                className="relative flex w-full items-center gap-3 rounded-3xl bg-surface-2 p-4 text-left ring-1 ring-line transition-transform active:scale-[0.99]"
              >
                {meta.easterEgg && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-14 top-2.5 -rotate-6 select-none text-[12px] font-semibold italic tracking-wider text-ink-2/75"
                  >
                    {meta.easterEgg}
                  </span>
                )}
                <span
                  className="flex size-12 items-center justify-center rounded-2xl text-2xl"
                  style={{ backgroundColor: `${meta.color}22` }}
                >
                  {meta.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{meta.name}</span>
                  <span className="block text-xs text-ink-3">{meta.desc}</span>
                </span>
                <span className="text-ink-3">›</span>
              </button>
            )
          })}
        </div>
      </Sheet>
    </div>
  )
}

/* =============== 今日状态卡 =============== */

function TodayCard({ state }: { state: Awaited<ReturnType<typeof getTodayState>> | undefined }) {
  const navigate = useNavigate()
  if (state === undefined) return <div className="skeleton h-36 rounded-3xl" />

  if (state.kind === 'active' && state.session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => navigate(`/workout/${state.session!.id}`)}
        className="cursor-pointer rounded-3xl bg-accent p-5 text-accent-ink active:scale-[0.99]"
      >
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide opacity-75">
          <Flame size={14} className="animate-pulse" /> 训练进行中
        </div>
        <div className="mt-1.5 text-2xl font-bold">{state.session.title}</div>
        <div className="num mt-1 text-sm font-semibold opacity-80">
          {state.actionCount} 个动作 · {state.setCount} 组 · 点击继续 →
        </div>
      </motion.div>
    )
  }

  if (state.kind === 'trained' && state.session) {
    return (
      <Card className={WM_PANEL + " !p-5"}>
        <BrandWatermark size="md" pos="br" opacity="opacity-[0.03]" />
        <div className="flex items-center gap-2 text-xs font-semibold text-grow">
          <span className="flex size-5 items-center justify-center rounded-full bg-grow/15 text-[10px]">✓</span>
          今日已训练
        </div>
        <div className="mt-2 text-2xl font-bold">{state.session.title}</div>
        <div className="num mt-1 text-sm text-ink-3">
          {state.actionCount} 个动作 · {state.setCount} 组
          {state.session.notes ? ` · ${state.session.notes}` : ''}
        </div>
        {state.activities && state.activities.length > 0 && (
          <button
            onClick={() => navigate(state.activities!.length === 1 ? activityDetailPath(state.activities![0]) : '/history')}
            className="mt-2 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: `${SPORT_META.badminton.color}1f`, color: SPORT_META.badminton.color }}
          >
            {state.activities.map((x) => SPORT_META[x.sport as keyof typeof SPORT_META].emoji).join('')} 今天还做了 {state.activities.length} 次其他运动
          </button>
        )}
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate(`/workout/${state.session!.id}`)}>
          查看详情
        </Button>
      </Card>
    )
  }

  if (state.kind === 'badminton' && state.activities?.length) {
    const a = state.activities[state.activities.length - 1]
    const meta = SPORT_META[a.sport as keyof typeof SPORT_META]
    return (
      <Card className="!p-5">
        <button type="button" onClick={() => navigate(activityDetailPath(a))} className="w-full text-left active:opacity-80">
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: meta.color }}>
            <span className="flex size-5 items-center justify-center rounded-full text-[10px]" style={{ backgroundColor: `${meta.color}22` }}>
              {meta.emoji}
            </span>
            今日已运动
          </div>
          <div className="mt-2 text-2xl font-bold">{meta.name}</div>
          <div className="num mt-1 text-sm text-ink-3">
            {(a.sport === 'badminton' || a.sport === 'tennis') && a.playType ? (a.playType === 'singles' ? '单打' : '双打') : ''}
            {a.sport === 'badminton' && a.score?.gamesTotal ? ` · ${a.score.gamesTotal} 局` : ''}
            {a.sport === 'tennis' && (a.score?.gamesTotal ?? 0) > 0 ? ` · ${a.score?.gamesTotal} 盘` : ''}
            {a.sport === 'tennis' && a.scoreText ? ` · ${a.scoreText}` : ''}
            {a.sport === 'swimming' && a.distanceM ? ` · ${a.distanceM >= 1000 ? (a.distanceM / 1000).toFixed(2) + ' km' : a.distanceM + ' m'}` : ''}
            {a.sport === 'volleyball' && a.score?.gamesTotal ? ` · 局分 ${a.score.gamesWon ?? 0}:${a.score.gamesLost ?? 0}` : ''}
            {a.durationMin ? ` · ${fmtHoursMin(a.durationMin)}` : ''}
            {state.activities.length > 1 ? ` · 共 ${state.activities.length} 条记录` : ''}
          </div>
        </button>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate(SPORT_META[a.sport].routeBase)}>
          查看统计
        </Button>
      </Card>
    )
  }

  if (state.kind === 'rest') {
    return (
      <Card className="!p-5 !bg-rest/[0.07] ring-rest/25">
        <div className="text-2xl font-bold">今天是恢复日</div>
        <p className="mt-1 text-[15px] text-ink-2">休息也是训练的一部分。</p>
        <Button variant="ghost" size="sm" className="mt-2 !text-rest" onClick={() => navigate('/train')}>
          改变主意,去训练 →
        </Button>
      </Card>
    )
  }

  return (
    <Card className={WM_PANEL + " !p-5"}>
      <BrandWatermark size="md" pos="br" opacity="opacity-[0.03]" />
      <div className="text-2xl font-bold">今天还没有训练</div>
      <p className="mt-1 text-[15px] text-ink-3">选择部位,几分钟就能记完。</p>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => navigate('/train')}>
          <Play size={16} /> 开始训练
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await markRest(todayStr())
            toast('已记录今天休息 🌙')
          }}
        >
          <Moon size={16} /> 记录休息
        </Button>
      </div>
    </Card>
  )
}

function activityDetailPath(activity: { id: string; sport: keyof typeof SPORT_META }): string {
  return activity.sport === 'badminton'
    ? `/badminton/${activity.id}`
    : activity.sport === 'volleyball'
      ? `/volleyball/${activity.id}`
      : `/${activity.sport}/${activity.id}/edit`
}

/* =============== 统计磁贴 =============== */

function StatTile({
  label,
  value,
  unit,
  className,
  delay = 0,
}: {
  label: string
  value: string
  unit?: string
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('rounded-3xl bg-surface p-4 ring-1 ring-line', className)}
    >
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className="num mt-1 text-2xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-ink-3">{unit}</span>}
      </div>
    </motion.div>
  )
}

/* =============== 本月部位分布(迷你条) =============== */

function MonthPartsCard() {
  const navigate = useNavigate()
  const monthStart = todayStr().slice(0, 7) + '-01'
  const parts = useLiveQuery(() => getPartDistribution(monthStart, addDays(monthStart, 31)), [monthStart], undefined)
  const max = Math.max(1, ...(parts ?? []).map((p) => p.sessions))
  const total = (parts ?? []).reduce((a, p) => a + p.sessions, 0)
  return (
    <Card delay={0.16} onClick={() => navigate('/history')}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">本月训练分布</h3>
        <span className="text-xs text-ink-3">{total > 0 ? `共 ${total} 次` : ''}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {(parts ?? []).map((p) => (
          <div key={p.part} className="flex items-center gap-2">
            <span className="w-8 text-xs text-ink-2">{p.name}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(p.sessions / max) * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ backgroundColor: p.color }}
              />
            </div>
            <span className="num w-6 text-right text-xs text-ink-3">{p.sessions}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-ink-3">查看历史 →</div>
    </Card>
  )
}

/* =============== 快捷按钮 =============== */

function QuickAction({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-2xl px-4 py-3.5 text-[14px] font-semibold transition-all active:scale-[0.97]',
        primary ? 'bg-accent text-accent-ink' : 'bg-surface text-ink ring-1 ring-line',
      )}
    >
      {icon}
      {label}
    </motion.button>
  )
}

/* =============== 洞察卡片 =============== */

function InsightCard({ insight, onDismiss }: { insight: Insight; onDismiss: () => void }) {
  const navigate = useNavigate()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-line"
    >
      <span className="text-lg">{insight.icon}</span>
      <button onClick={() => (insight.link ? navigate(insight.link) : undefined)} className="flex-1 text-left text-[13px] leading-relaxed text-ink-2">
        {insight.text}
      </button>
      <button onClick={onDismiss} className="shrink-0 rounded-full p-1 text-ink-3 hover:text-ink" aria-label="关闭提醒">
        <span className="text-xs">✕</span>
      </button>
    </motion.div>
  )
}
