import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Moon, Dumbbell, ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/db/db'
import type { ActivitySession } from '@/db/models'
import { SPORT_META } from '@/db/models'
import { describeSession, BadmintonDetailSheet } from '@/pages/BadmintonPages'
import { BODY_PART_META, type BodyPartId, type WorkoutSession } from '@/db/models'
import { addDays, cn, fmtDateCN, fmtMonthCN, fmtVolume, fmtWeekdayCN, todayStr, parseLocalDate, toLocalDate } from '@/lib/util'
import { setVolume } from '@/services/calc'
import { getDayStates } from '@/services/stats'
import { PageHeader, Button, Segmented } from '@/components/ui/basic'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'

/**
 * 历史 = 日历 + 时间线
 * 日历:训练日 / 休息日 / 未记录 三态一目了然
 * 时间线:每个会话独立一行(支持同日多练)
 */

const PAGE_DAYS = 30

interface TimelineRow {
  date: string
  session?: WorkoutSession
  activity?: ActivitySession
  rest?: boolean
  actions: number
  sets: number
  volume: number
  sortTs: number
}

type HistoryFilter = 'all' | 'strength' | 'badminton'

export default function HistoryPage() {
  const [mode, setMode] = useState<'calendar' | 'timeline'>('calendar')
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [monthCursor, setMonthCursor] = useState(() => todayStr().slice(0, 7))
  const [days, setDays] = useState(PAGE_DAYS)

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <BrandWatermark size="page" pos="br" />
      <PageHeader title="历史" subtitle="训练 · 休息 · 未记录" />
      <div className="space-y-2.5 px-4 pb-3">
        <Segmented
          options={[
            { value: 'calendar', label: '日历' },
            { value: 'timeline', label: '时间线' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'timeline' && (
          <div className="flex gap-1.5">
            {(
              [
                { v: 'all', label: '全部' },
                { v: 'strength', label: '🏋️ 力量' },
                { v: 'badminton', label: '🏸 羽毛球' },
              ] as { v: HistoryFilter; label: string }[]
            ).map((o) => (
              <button
                key={o.v}
                onClick={() => setFilter(o.v)}
                className={
                  'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ' +
                  (filter === o.v ? 'bg-surface-3 text-ink' : 'text-ink-3')
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === 'calendar' ? (
        <CalendarView cursor={monthCursor} onCursor={setMonthCursor} />
      ) : (
        <TimelineView days={days} filter={filter} onMore={() => setDays((d) => d + PAGE_DAYS)} />
      )}
    </div>
  )
}

/* =============== 日历视图 =============== */

function CalendarView({ cursor, onCursor }: { cursor: string; onCursor: (m: string) => void }) {
  const navigate = useNavigate()
  const [detailActivity, setDetailActivity] = useState<ActivitySession | null>(null)
  const [y, m] = cursor.split('-').map(Number)
  const first = `${cursor}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const last = `${cursor}-${String(lastDay).padStart(2, '0')}`
  const firstWeekday = parseLocalDate(first).getDay() // 0=周日

  const dayStates = useLiveQuery(() => getDayStates(first, last), [first, last], undefined)
  const today = todayStr()

  const prevMonth = () => onCursor(toLocalDate(new Date(y, m - 2, 1)).slice(0, 7))
  const nextMonth = () => onCursor(toLocalDate(new Date(y, m, 1)).slice(0, 7))
  const isCurrentMonth = cursor === today.slice(0, 7)

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => `${cursor}-${String(i + 1).padStart(2, '0')}`),
  ]

  // 当月统计
  const monthStats = useMemo(() => {
    let trained = 0
    let rest = 0
    for (const ds of dayStates?.values() ?? []) {
      if (ds.kind === 'trained') trained++
      else if (ds.kind === 'rest') rest++
    }
    return { trained, rest }
  }, [dayStates])

  return (
    <div className="mx-auto max-w-2xl px-4">
      <div className="mb-2 flex items-center justify-between rounded-2xl bg-surface px-2 py-2 ring-1 ring-line">
        <button onClick={prevMonth} className="rounded-xl p-2 text-ink-2 hover:bg-surface-2" aria-label="上个月">
          <ChevronLeft size={18} />
        </button>
        <span className="text-[15px] font-semibold">{fmtMonthCN(cursor)}</span>
        <button
          onClick={nextMonth}
          disabled={isCurrentMonth}
          className="rounded-xl p-2 text-ink-2 hover:bg-surface-2 disabled:opacity-30"
          aria-label="下个月"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className={WM_PANEL + " rounded-3xl bg-surface p-3 ring-1 ring-line"}>
        <BrandWatermark size="md" pos="tl" opacity="opacity-[0.028]" />
        <div className="grid grid-cols-7 gap-1 pb-1.5 text-center text-[10px] text-ink-3">
          {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <span key={`e${i}`} />
            const ds = dayStates?.get(date)
            const kind = ds?.kind
            const isToday = date === today
            const future = date > today
            return (
              <button
                key={date}
                onClick={() => {
                  if (ds?.session) navigate(`/workout/${ds.session.id}`)
                  else if (ds?.activities?.length) setDetailActivity(ds.activities[0])
                }}
                className={cn(
                  'relative flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] transition-colors',
                  kind === 'trained' && 'bg-accent font-bold text-accent-ink',
                  kind === 'rest' && 'bg-rest/15 font-medium text-rest',
                  (kind === 'unrecorded' || !kind) && 'text-ink-3',
                  future && 'opacity-35',
                  ds?.session && 'active:scale-90',
                  isToday && kind !== 'trained' && 'ring-1 ring-accent/60',
                )}
              >
                {parseLocalDate(date).getDate()}
                {kind === 'trained' && ds?.session && (
                  <span className="absolute bottom-1 flex gap-0.5">
                    {ds.session.bodyParts.slice(0, 3).map((_, pi) => (
                      <span key={pi} className="size-1 rounded-full bg-[#F5EFEA]/60" />
                    ))}
                    {ds.activities && ds.activities.length > 0 && <span className="absolute -right-0.5 -top-0.5 text-[8px]">🏸</span>}
                  </span>
                )}
                {kind === 'trained' && !ds?.session && ds?.activities && ds.activities.length > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 text-[8px]">🏸</span>
                )}
                {kind === 'rest' && <span className="absolute bottom-1 text-[7px]">休</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex justify-center gap-4 text-[10px] text-ink-3">
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-accent" />训练 {monthStats.trained}</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-rest/40" />休息 {monthStats.rest}</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-surface-3" />未记录</span>
        </div>
      </div>
      <p className="mt-2 px-1 text-center text-[11px] text-ink-3">点击训练日查看当天详情</p>
      <BadmintonDetailSheet
        session={detailActivity}
        onClose={() => setDetailActivity(null)}
        onEdit={(a) => {
          setDetailActivity(null)
          navigate(`/badminton/${a.id}/edit`)
        }}
      />
    </div>
  )
}

/* =============== 时间线视图 =============== */

function TimelineView({ days, filter, onMore }: { days: number; filter: HistoryFilter; onMore: () => void }) {
  const navigate = useNavigate()
  const [detailActivity, setDetailActivity] = useState<ActivitySession | null>(null)
  const end = todayStr()
  const start = addDays(end, -(days - 1))

  const rows = useLiveQuery(async (): Promise<TimelineRow[]> => {
    const [sessions, rests, sets, wes, activities] = await Promise.all([
      db.sessions.where('date').between(start, end, true, true).and((s) => s.status === 'completed').toArray(),
      db.dailyStatuses.where('date').between(start, end, true, true).toArray(),
      db.sets.where('date').between(start, end, true, true).toArray(),
      db.workoutExercises.toArray(),
      db.activitySessions.where('date').between(start, end, true, true).toArray(),
    ])
    const weCount = new Map<string, Set<string>>()
    for (const we of wes) {
      let s = weCount.get(we.sessionId)
      if (!s) weCount.set(we.sessionId, (s = new Set()))
      s.add(we.exerciseId)
    }
    const bySession = new Map<string, { sets: number; volume: number }>()
    for (const st of sets) {
      const agg = bySession.get(st.sessionId) ?? { sets: 0, volume: 0 }
      agg.sets++
      agg.volume += setVolume(st)
      bySession.set(st.sessionId, agg)
    }

    const trainedDates = new Set(sessions.map((s) => s.date))
    const sessionRows: TimelineRow[] = sessions
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .map((session) => {
        const agg = bySession.get(session.id)
        return {
          date: session.date,
          session,
          actions: weCount.get(session.id)?.size ?? 0,
          sets: agg?.sets ?? 0,
          volume: Math.round(agg?.volume ?? 0),
          sortTs: session.completedAt ?? 0,
        }
      })
    const badmintonRows: TimelineRow[] = activities
      .filter((a) => a.sport === 'badminton')
      .map((a) => ({ date: a.date, activity: a, actions: 0, sets: 0, volume: 0, sortTs: a.createdAt }))
    const restRows: TimelineRow[] = rests
      .filter((r) => !trainedDates.has(r.date))
      .map((r) => ({ date: r.date, rest: true, actions: 0, sets: 0, volume: 0, sortTs: 0 }))
    const all = [...sessionRows, ...badmintonRows, ...restRows]
    const filtered = filter === 'all' ? all : all.filter((r) => (filter === 'strength' ? r.session : r.activity))
    return filtered.sort((a, b) =>
      a.date === b.date ? b.sortTs - a.sortTs : a.date < b.date ? 1 : -1,
    )
  }, [start, end, filter], undefined)

  return (
    <main className="mx-auto max-w-2xl px-4">
      {rows === undefined && <div className="skeleton h-64" />}
      {rows !== undefined && rows.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-3xl bg-surface-2 text-2xl">📅</div>
          <p className="text-ink-2">还没有训练记录</p>
          <p className="mt-1 text-sm text-ink-3">完成第一次训练后,这里会出现你的时间线</p>
          <Button className="mt-5" onClick={() => navigate('/train')}>
            去训练
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {rows?.map((row, i) =>
          row.activity ? (
            <motion.button
              key={row.activity.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.3 }}
              onClick={() => setDetailActivity(row.activity!)}
              className="flex w-full items-center gap-3.5 rounded-3xl bg-surface p-4 text-left ring-1 ring-line active:scale-[0.99]"
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg"
                style={{ backgroundColor: `${SPORT_META.badminton.color}22` }}
              >
                {SPORT_META.badminton.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[15px] font-semibold">{fmtDateCN(row.date)}</span>
                  <span className="text-xs text-ink-3">{fmtWeekdayCN(row.date)}</span>
                </span>
                <span className="num mt-0.5 block truncate text-[13px] text-ink-3">
                  羽毛球 · {describeSession(row.activity)}
                </span>
              </span>
              {row.activity.isDemo === 1 && (
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">示例</span>
              )}
            </motion.button>
          ) : (
          <motion.button
            key={(row.session?.id ?? 'rest') + row.date + i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.3 }}
            onClick={() => row.session && navigate(`/workout/${row.session.id}`)}
            className={cn(
              'flex w-full items-center gap-3.5 rounded-3xl p-4 text-left ring-1 ring-line',
              row.session ? 'bg-surface active:scale-[0.99]' : 'bg-surface/40',
            )}
          >
            <span
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-2xl',
                row.session ? 'bg-accent text-accent-ink' : 'bg-rest/15 text-rest',
              )}
            >
              {row.session ? <Dumbbell size={20} /> : <Moon size={20} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[15px] font-semibold">{fmtDateCN(row.date)}</span>
                <span className="text-xs text-ink-3">{fmtWeekdayCN(row.date)}</span>
              </span>
              {row.session ? (
                <span className="num mt-0.5 block truncate text-[13px] text-ink-3">
                  {(row.session.bodyParts as BodyPartId[]).map((p) => BODY_PART_META[p]?.name).join(' · ')} ·{' '}
                  {row.actions} 个动作 {row.sets} 组
                  {row.volume > 0 ? ` · ${fmtVolume(row.volume)}` : ''}
                </span>
              ) : (
                <span className="mt-0.5 block text-[13px] text-ink-3">主动休息 · 恢复日</span>
              )}
            </span>
            {row.session?.isDemo === 1 && (
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">示例</span>
            )}
          </motion.button>
          )
        )}
      </div>
      <BadmintonDetailSheet
        session={detailActivity}
        onClose={() => setDetailActivity(null)}
        onEdit={(a) => {
          setDetailActivity(null)
          navigate(`/badminton/${a.id}/edit`)
        }}
      />
      {rows !== undefined && rows.length >= 3 && (
        <Button variant="secondary" block className="mt-4" onClick={onMore}>
          加载更早({days} 天前之前)
        </Button>
      )}
    </main>
  )
}
