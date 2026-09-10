import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronLeft, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/db'
import {
  SPORT_META,
  VOLLEYBALL_POSITION_LABEL,
  VOLLEYBALL_POSITIONS,
  VOLLEYBALL_SESSION_LABEL,
  VOLLEYBALL_SESSION_TYPES,
  type ActivitySession,
  type VolleyballSetScore,
  type VolleyballStats,
} from '@/db/models'
import {
  createActivity,
  deleteActivity,
  getActivity,
  getVolleyballStats,
  getVolleyballYearTrend,
  safePercent,
  updateActivity,
  validateVolleyballStats,
  volleyballDirectPoints,
  volleyballPerformanceNotes,
  volleyballSetTally,
  type ActivityInput,
} from '@/services/activity'
import { fmtDateCN, fmtHoursMin, parseLocalDate, todayStr } from '@/lib/util'
import { BarsChart } from '@/components/charts/charts'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'
import { Button, Card, EmptyState, SectionTitle } from '@/components/ui/basic'
import { toast } from '@/store/settings'

const META = SPORT_META.volleyball
const INPUT = 'num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50'

function hasValues(group?: Record<string, number | undefined>): boolean {
  return Object.values(group ?? {}).some((value) => value !== undefined)
}

function cleanStats(stats: VolleyballStats): VolleyballStats | undefined {
  const cleaned: VolleyballStats = {}
  for (const key of Object.keys(stats) as (keyof VolleyballStats)[]) {
    const group = stats[key]
    if (hasValues(group)) Object.assign(cleaned, { [key]: group })
  }
  return Object.keys(cleaned).length ? cleaned : undefined
}

function toTimeStr(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatClock(timestamp?: number): string | null {
  if (!timestamp) return null
  return toTimeStr(timestamp)
}

function rateText(value: number | null): string {
  return value === null ? '--' : `${value}%`
}

function resultLabel(session: ActivitySession): { label: string; tone: string } | null {
  const result = volleyballSetTally(session.volleyballSets).result
  if (result === 'win') return { label: '胜利', tone: 'bg-grow/15 text-grow' }
  if (result === 'loss') return { label: '失利', tone: 'bg-danger/15 text-danger' }
  if (result === 'draw') return { label: '平局', tone: 'bg-surface-3 text-ink-2' }
  return null
}

export function VolleyballFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(id)
  const LOADING = useMemo(() => Symbol('loading'), [])
  const existing = useLiveQuery(
    () => (id ? getActivity(id) : Promise.resolve(undefined)),
    [id],
    LOADING as unknown as ActivitySession | undefined,
  ) as ActivitySession | undefined | typeof LOADING

  const [form, setForm] = useState<ActivityInput>({
    sport: 'volleyball',
    date: todayStr(),
    volleyballSessionType: 'training',
  })
  const [sets, setSets] = useState<VolleyballSetScore[]>([])
  const [stats, setStats] = useState<VolleyballStats>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing || !existing || existing === LOADING) return
    const current = existing as ActivitySession
    // eslint-disable-next-line react/set-state-in-effect -- hydrate the edit form once IndexedDB returns the record
    setForm({
      sport: 'volleyball',
      date: current.date,
      startTime: current.startTime,
      durationMin: current.durationMin,
      volleyballSessionType: current.volleyballSessionType ?? 'training',
      volleyballPosition: current.volleyballPosition,
      venue: current.venue ?? '',
      partners: current.partners ?? '',
      fitness: current.fitness ?? {},
      notes: current.notes ?? '',
    })
    setSets(current.volleyballSets ?? [])
    setStats(current.volleyballStats ?? {})
    setAdvancedOpen(Boolean(current.volleyballStats))
  }, [editing, existing, LOADING])

  useEffect(() => {
    if (editing && existing !== LOADING && existing === undefined) {
      toast('记录不存在或已被删除', 'error')
      navigate('/volleyball', { replace: true })
    }
  }, [editing, existing, LOADING, navigate])

  if (editing && existing === LOADING) return <div className="p-6 text-ink-3">加载中…</div>

  const isMatch = form.volleyballSessionType === 'scrimmage' || form.volleyballSessionType === 'official'
  const setStat = <G extends keyof VolleyballStats>(group: G, key: string, value?: number) => {
    setStats((current) => ({ ...current, [group]: { ...(current[group] ?? {}), [key]: value } }))
  }

  async function handleSave() {
    if (!form.date) return toast('请选择日期', 'error')
    if (form.durationMin !== undefined && form.durationMin <= 0) return toast('运动时长必须大于 0', 'error')
    const statError = validateVolleyballStats(stats)
    if (statError) return toast(statError, 'error')
    const completedSets = sets.filter((set) => set.ourScore !== undefined || set.opponentScore !== undefined)
    if (completedSets.some((set) => set.ourScore === undefined || set.opponentScore === undefined)) {
      return toast('每局比分请完整填写我方和对方', 'error')
    }
    const avgHr = form.fitness?.avgHr
    const maxHr = form.fitness?.maxHr
    if ((avgHr !== undefined && avgHr <= 0) || (maxHr !== undefined && maxHr <= 0)) return toast('心率必须大于 0', 'error')
    if (avgHr !== undefined && maxHr !== undefined && avgHr > maxHr) return toast('最高心率不能低于平均心率', 'error')

    setSaving(true)
    try {
      let startTime = form.startTime
      if (startTime !== undefined) {
        const date = parseLocalDate(form.date)
        const time = new Date(startTime)
        date.setHours(time.getHours(), time.getMinutes(), 0, 0)
        startTime = date.getTime()
      }
      const tally = volleyballSetTally(completedSets)
      const payload: ActivityInput = {
        ...form,
        startTime,
        venue: form.venue?.trim() || undefined,
        partners: form.partners?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
        isMatch: isMatch ? 1 : undefined,
        volleyballSets: isMatch && completedSets.length ? completedSets : undefined,
        volleyballStats: cleanStats(stats),
        fitness: hasValues(form.fitness) ? form.fitness : undefined,
        score: isMatch && tally.decided ? { gamesTotal: tally.decided, gamesWon: tally.won, gamesLost: tally.lost } : undefined,
      }
      if (editing && id) {
        await updateActivity(id, payload)
        toast('排球记录已更新')
        navigate(`/volleyball/${id}`, { replace: true })
      } else {
        const created = await createActivity(payload)
        toast('已记录本次排球 🏐')
        navigate(`/volleyball/${created.id}`, { replace: true })
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative isolate min-h-dvh overflow-clip bg-bg pb-32">
      <BrandWatermark size="page" pos="br" />
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回"><ChevronLeft size={22} /></button>
          <h1 className="flex-1 text-[17px] font-semibold">{editing ? '编辑排球记录' : '记录排球'}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <FormCard title="基本信息">
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期">
              <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))} className={INPUT} />
            </Field>
            <Field label="开始时间（可选）">
              <input
                type="time"
                value={form.startTime ? toTimeStr(form.startTime) : ''}
                onChange={(e) => {
                  if (!e.target.value) return setForm((c) => ({ ...c, startTime: undefined }))
                  const [hours, minutes] = e.target.value.split(':').map(Number)
                  const date = parseLocalDate(form.date)
                  date.setHours(hours, minutes, 0, 0)
                  setForm((c) => ({ ...c, startTime: date.getTime() }))
                }}
                className={INPUT}
              />
            </Field>
          </div>
          <Field label="运动时长（分钟）">
            <NumberInput value={form.durationMin} placeholder="如 60" onChange={(durationMin) => setForm((c) => ({ ...c, durationMin }))} />
          </Field>
          <Field label="记录类型">
            <div className="grid grid-cols-2 gap-2">
              {VOLLEYBALL_SESSION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((c) => ({ ...c, volleyballSessionType: type }))}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98] ${form.volleyballSessionType === type ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-3 ring-1 ring-line'}`}
                >
                  {VOLLEYBALL_SESSION_LABEL[type]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="位置（可选）">
            <select value={form.volleyballPosition ?? ''} onChange={(e) => setForm((c) => ({ ...c, volleyballPosition: (e.target.value || undefined) as ActivityInput['volleyballPosition'] }))} className={INPUT}>
              <option value="">不记录位置</option>
              {VOLLEYBALL_POSITIONS.map((position) => <option key={position} value={position}>{VOLLEYBALL_POSITION_LABEL[position]}</option>)}
            </select>
          </Field>
        </FormCard>

        {isMatch && (
          <FormCard title="比赛比分" subtitle="局数和分制不限，按实际对抗记录。">
            <div className="space-y-2">
              {sets.map((set, index) => (
                <div key={index} className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 rounded-2xl bg-surface-2 p-2.5">
                  <span className="w-10 text-xs text-ink-3">第{index + 1}局</span>
                  <NumberInput compact value={set.ourScore} placeholder="我方" onChange={(ourScore) => setSets((rows) => rows.map((row, i) => i === index ? { ...row, ourScore } : row))} />
                  <span className="text-ink-3">:</span>
                  <NumberInput compact value={set.opponentScore} placeholder="对方" onChange={(opponentScore) => setSets((rows) => rows.map((row, i) => i === index ? { ...row, opponentScore } : row))} />
                  <button type="button" onClick={() => setSets((rows) => rows.filter((_, i) => i !== index))} className="rounded-lg p-1.5 text-ink-3 hover:text-danger" aria-label={`删除第 ${index + 1} 局`}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setSets((rows) => [...rows, {}])}><Plus size={15} /> 添加一局</Button>
            {sets.some((set) => set.ourScore !== undefined && set.opponentScore !== undefined) && (
              <div className="num rounded-2xl bg-surface-2 px-4 py-3 text-center text-sm">
                当前局分 <strong>{volleyballSetTally(sets).won} : {volleyballSetTally(sets).lost}</strong>
              </div>
            )}
          </FormCard>
        )}

        <FormCard title="身体数据" subtitle="可选，输入方式与现有运动记录一致。">
          <div className="grid grid-cols-2 gap-3">
            <Field label="平均心率">
              <NumberInput value={form.fitness?.avgHr} placeholder="bpm" onChange={(avgHr) => setForm((c) => ({ ...c, fitness: { ...c.fitness, avgHr } }))} />
            </Field>
            <Field label="最高心率">
              <NumberInput value={form.fitness?.maxHr} placeholder="bpm" onChange={(maxHr) => setForm((c) => ({ ...c, fitness: { ...c.fitness, maxHr } }))} />
            </Field>
          </div>
        </FormCard>

        <Card className="!p-0">
          <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="flex w-full items-center justify-between p-4 text-left">
            <span>
              <span className="block text-[15px] font-semibold">专业数据（可选）</span>
              <span className="mt-0.5 block text-xs text-ink-3">发球 · 进攻 · 拦网 · 一传 · 防守 · 二传</span>
            </span>
            {advancedOpen ? <ChevronUp size={19} className="text-ink-3" /> : <ChevronDown size={19} className="text-ink-3" />}
          </button>
          {advancedOpen && (
            <div className="space-y-4 border-t border-line p-4">
              <StatGroup title="发球 Serve" rate={`ACE率 ${rateText(safePercent(stats.serve?.aces, stats.serve?.attempts))} · 失误率 ${rateText(safePercent(stats.serve?.errors, stats.serve?.attempts))}`}>
                <StatInput label="发球次数" value={stats.serve?.attempts} onChange={(v) => setStat('serve', 'attempts', v)} />
                <StatInput label="ACE 球" value={stats.serve?.aces} onChange={(v) => setStat('serve', 'aces', v)} />
                <StatInput label="发球失误" value={stats.serve?.errors} onChange={(v) => setStat('serve', 'errors', v)} />
              </StatGroup>
              <StatGroup title="进攻 Attack" rate={`得分率 ${rateText(safePercent(stats.attack?.points, stats.attack?.attempts))} · 净效率 ${rateText(stats.attack?.attempts ? Math.round((((stats.attack?.points ?? 0) - (stats.attack?.errors ?? 0) - (stats.attack?.blocked ?? 0)) / stats.attack.attempts) * 1000) / 10 : null)}`}>
                <StatInput label="进攻次数" value={stats.attack?.attempts} onChange={(v) => setStat('attack', 'attempts', v)} />
                <StatInput label="进攻得分" value={stats.attack?.points} onChange={(v) => setStat('attack', 'points', v)} />
                <StatInput label="进攻失误" value={stats.attack?.errors} onChange={(v) => setStat('attack', 'errors', v)} />
                <StatInput label="被拦次数" value={stats.attack?.blocked} onChange={(v) => setStat('attack', 'blocked', v)} />
              </StatGroup>
              <p className="-mt-2 text-[11px] leading-relaxed text-ink-3">得分率：有多少次进攻直接得分。净效率：综合得分、失误和被拦。</p>
              <StatGroup title="拦网 Block">
                <StatInput label="拦网得分" value={stats.block?.points} onChange={(v) => setStat('block', 'points', v)} />
                <StatInput label="有效拦网" value={stats.block?.effective} onChange={(v) => setStat('block', 'effective', v)} />
              </StatGroup>
              <StatGroup title="接发球 Reception" rate={`到位率 ${rateText(safePercent(stats.reception?.perfect, stats.reception?.attempts))} · 失误率 ${rateText(safePercent(stats.reception?.errors, stats.reception?.attempts))}`}>
                <StatInput label="接发次数" value={stats.reception?.attempts} onChange={(v) => setStat('reception', 'attempts', v)} />
                <StatInput label="到位球" value={stats.reception?.perfect} onChange={(v) => setStat('reception', 'perfect', v)} />
                <StatInput label="接发失误" value={stats.reception?.errors} onChange={(v) => setStat('reception', 'errors', v)} />
              </StatGroup>
              <StatGroup title="防守 Dig" rate={`成功率 ${rateText(safePercent(stats.dig?.successful, stats.dig?.attempts))}`}>
                <StatInput label="防守次数" value={stats.dig?.attempts} onChange={(v) => setStat('dig', 'attempts', v)} />
                <StatInput label="有效防守" value={stats.dig?.successful} onChange={(v) => setStat('dig', 'successful', v)} />
              </StatGroup>
              <StatGroup title="二传 Set" rate={`有效率 ${rateText(safePercent(stats.set?.successful, stats.set?.attempts))}`}>
                <StatInput label="二传次数" value={stats.set?.attempts} onChange={(v) => setStat('set', 'attempts', v)} />
                <StatInput label="有效二传" value={stats.set?.successful} onChange={(v) => setStat('set', 'successful', v)} />
              </StatGroup>
            </div>
          )}
        </Card>

        <FormCard title="其他" subtitle="全部可选">
          <Field label="场地"><input value={form.venue ?? ''} onChange={(e) => setForm((c) => ({ ...c, venue: e.target.value }))} placeholder="如：学校体育馆" className={INPUT} /></Field>
          <Field label="对手 / 队伍"><input value={form.partners ?? ''} onChange={(e) => setForm((c) => ({ ...c, partners: e.target.value }))} placeholder="如：vs 校队 / 蓝队" className={INPUT} /></Field>
          <Field label="备注"><textarea value={form.notes ?? ''} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} rows={3} placeholder="今天的训练内容或感受…" className="w-full resize-none rounded-xl bg-surface-2 p-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50" /></Field>
        </FormCard>

        <div className="flex gap-2 safe-bottom">
          {editing && id && (
            <Button variant="danger" className="shrink-0 px-4" aria-label="删除记录" onClick={async () => {
              if (!confirm('删除这条排球记录？此操作不可恢复。')) return
              await deleteActivity(id)
              toast('记录已删除')
              navigate('/volleyball', { replace: true })
            }}><Trash2 size={17} /></Button>
          )}
          <Button block size="lg" loading={saving} onClick={handleSave}>{editing ? '保存修改' : '保存记录'}</Button>
        </div>
      </main>
    </div>
  )
}

export function VolleyballPage() {
  const navigate = useNavigate()
  const sessions = useLiveQuery(() => db.activitySessions.where('sport').equals('volleyball').sortBy('date').then((rows) => rows.reverse()), [], undefined)
  const dashboard = useLiveQuery(async () => {
    const month = todayStr().slice(0, 7)
    const [all, current, trend] = await Promise.all([
      getVolleyballStats(),
      getVolleyballStats(`${month}-01`, `${month}-31`),
      getVolleyballYearTrend(Number(todayStr().slice(0, 4))),
    ])
    return { all, current, trend }
  }, [], undefined)
  const recent = sessions?.[0]

  return (
    <div className="relative isolate min-h-dvh overflow-clip bg-bg pb-28">
      <BrandWatermark size="page" pos="br" />
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回"><ChevronLeft size={22} /></button>
          <h1 className="flex-1 text-[17px] font-semibold">🏐 排球 Volleyball</h1>
          <button onClick={() => navigate('/volleyball/new')} className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink active:scale-95" aria-label="新建排球记录"><Plus size={18} /></button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 pt-4">
        <Card className={`${WM_PANEL} !p-5`}>
          <BrandWatermark size="md" pos="br" opacity="opacity-[0.03]" />
          <SectionTitle title="本月排球" />
          <div className="grid grid-cols-2 gap-y-5 text-center">
            <BigStat label="次数" value={dashboard ? String(dashboard.current.sessions) : '…'} sub="次" />
            <BigStat label="总时长" value={dashboard ? fmtHoursMin(dashboard.current.totalMinutes) : '…'} />
            <BigStat label="比赛 / 对抗" value={dashboard ? String(dashboard.current.matchCount) : '…'} sub="场" />
            <BigStat label="总胜负" value={dashboard && dashboard.all.wins + dashboard.all.losses > 0 ? `${dashboard.all.wins}:${dashboard.all.losses}` : '—'} />
          </div>
        </Card>

        {recent ? (
          <Card onClick={() => navigate(`/volleyball/${recent.id}`)}>
            <SectionTitle title="最近一次" />
            <div className="flex items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ backgroundColor: `${META.color}22` }}>🏐</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{fmtDateCN(recent.date)} · {VOLLEYBALL_SESSION_LABEL[recent.volleyballSessionType ?? 'training']}</div>
                <div className="num mt-1 truncate text-sm text-ink-3">{sessionSummary(recent)}</div>
              </div>
              <span className="text-ink-3">›</span>
            </div>
            {volleyballPerformanceNotes(recent)[0] && <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{volleyballPerformanceNotes(recent)[0]}</p>}
          </Card>
        ) : sessions !== undefined ? (
          <Card><EmptyState icon="🏐" title="还没有排球记录" desc="30 秒记下时长；需要时再补充比分和专业数据。" actionText="记录第一次" onAction={() => navigate('/volleyball/new')} /></Card>
        ) : null}

        {sessions && sessions.length > 0 && (
          <Card>
            <SectionTitle title="年度月度趋势" />
            <BarsChart data={(dashboard?.trend ?? []).map((item) => ({ x: `${Number(item.month.slice(5))}月`, y: item.sessions }))} height={135} />
          </Card>
        )}

        {dashboard && dashboard.all.positions.length > 0 && (
          <Card>
            <SectionTitle title="位置记录" />
            <div className="flex flex-wrap gap-2">
              {dashboard.all.positions.map((item, index) => (
                <span key={item.position} className={`rounded-full px-3 py-1.5 text-xs ${index === 0 ? 'font-semibold text-ink' : 'text-ink-3'} bg-surface-2`}>
                  {VOLLEYBALL_POSITION_LABEL[item.position]} · {item.count}次{index === 0 ? ' · 最常用' : ''}
                </span>
              ))}
            </div>
          </Card>
        )}

        {sessions && sessions.length > 0 && (
          <section>
            <SectionTitle title="排球记录" />
            <div className="space-y-2">
              {sessions.map((session, index) => <VolleyballHistoryCard key={session.id} session={session} delay={index * 0.03} onClick={() => navigate(`/volleyball/${session.id}`)} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export function VolleyballDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const session = useLiveQuery(() => getActivity(id), [id], undefined)
  if (session === undefined) return <div className="min-h-dvh bg-bg p-6 text-ink-3">加载中…</div>
  if (session.sport !== 'volleyball') return <div className="min-h-dvh bg-bg p-6 text-ink-3">记录不存在。</div>
  const tally = volleyballSetTally(session.volleyballSets)
  const result = resultLabel(session)
  const stats = session.volleyballStats
  const direct = volleyballDirectPoints(stats)
  const notes = volleyballPerformanceNotes(session)
  const hasProfessional = Object.values(stats ?? {}).some((group) => hasValues(group))
  const primary = (hasProfessional ? [
    { label: '总得分', value: direct },
    { label: '进攻得分', value: stats?.attack?.points },
    { label: 'ACE', value: stats?.serve?.aces },
    { label: '拦网得分', value: stats?.block?.points },
    { label: '有效防守', value: stats?.dig?.successful },
  ] : []).filter((item) => item.value !== undefined && (item.value > 0 || item.label === '总得分'))
  const rates = [
    { label: '进攻得分率', value: safePercent(stats?.attack?.points, stats?.attack?.attempts) },
    { label: '进攻净效率', value: stats?.attack?.attempts ? Math.round((((stats.attack.points ?? 0) - (stats.attack.errors ?? 0) - (stats.attack.blocked ?? 0)) / stats.attack.attempts) * 1000) / 10 : null },
    { label: '一传到位率', value: safePercent(stats?.reception?.perfect, stats?.reception?.attempts) },
    { label: '防守成功率', value: safePercent(stats?.dig?.successful, stats?.dig?.attempts) },
  ].filter((item) => item.value !== null)

  return (
    <div className="relative isolate min-h-dvh overflow-clip bg-bg pb-28">
      <BrandWatermark size="page" pos="br" />
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate('/volleyball')} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回"><ChevronLeft size={22} /></button>
          <h1 className="flex-1 text-[17px] font-semibold">🏐 排球</h1>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/volleyball/${id}/edit`)}><Pencil size={15} /> 编辑</Button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <Card className={`${WM_PANEL} !p-5`}>
          <BrandWatermark size="md" pos="br" opacity="opacity-[0.03]" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-2xl font-bold">{fmtDateCN(session.date)}</div>
              <div className="num mt-1 text-sm text-ink-3">{[formatClock(session.startTime), session.durationMin ? fmtHoursMin(session.durationMin) : null, VOLLEYBALL_SESSION_LABEL[session.volleyballSessionType ?? 'training']].filter(Boolean).join(' · ')}</div>
            </div>
            {result && <span className={`rounded-full px-3 py-1 text-sm font-semibold ${result.tone}`}>{result.label}</span>}
          </div>
          {tally.decided > 0 && (
            <div className="num mt-5 text-center">
              <div className="text-4xl font-black">{tally.won} : {tally.lost}</div>
              <div className="mt-1 text-xs text-ink-3">局分</div>
            </div>
          )}
          {session.volleyballSets && session.volleyballSets.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {session.volleyballSets.map((set, index) => <span key={index} className="num rounded-xl bg-surface-2 px-3 py-2 text-sm">第{index + 1}局&nbsp; {set.ourScore ?? '--'} : {set.opponentScore ?? '--'}</span>)}
            </div>
          )}
        </Card>

        {primary.length > 0 && (
          <Card>
            <SectionTitle title="本场表现" />
            <div className="grid grid-cols-3 gap-2 text-center">
              {primary.map((item, index) => <div key={item.label} className={`rounded-2xl bg-surface-2 p-3 ${index === 0 ? 'col-span-3' : ''}`}><div className={`num font-bold ${index === 0 ? 'text-3xl' : 'text-xl'}`}>{item.value}</div><div className="mt-1 text-[10px] text-ink-3">{item.label}</div></div>)}
            </div>
            {rates.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2">{rates.map((item) => <div key={item.label} className="rounded-xl border border-line px-3 py-2"><div className="num font-semibold">{item.value}%</div><div className="text-[10px] text-ink-3">{item.label}</div></div>)}</div>}
          </Card>
        )}

        {notes.length > 0 && <Card><SectionTitle title="表现总结" /><div className="space-y-2">{notes.map((note) => <p key={note} className="rounded-2xl bg-surface-2 px-3 py-2.5 text-sm text-ink-2">{note}</p>)}</div></Card>}

        {stats && <VolleyballRawStats stats={stats} />}

        {(session.volleyballPosition || session.venue || session.partners || session.fitness?.avgHr || session.fitness?.maxHr || session.notes) && (
          <Card>
            <SectionTitle title="记录信息" />
            <div className="space-y-2 text-sm">
              {session.volleyballPosition && <InfoRow label="位置" value={VOLLEYBALL_POSITION_LABEL[session.volleyballPosition]} />}
              {session.venue && <InfoRow label="场地" value={session.venue} />}
              {session.partners && <InfoRow label="对手 / 队伍" value={session.partners} />}
              {session.fitness?.avgHr && <InfoRow label="平均心率" value={`${session.fitness.avgHr} bpm`} />}
              {session.fitness?.maxHr && <InfoRow label="最高心率" value={`${session.fitness.maxHr} bpm`} />}
              {session.notes && <div className="rounded-2xl bg-surface-2 px-3 py-2.5 leading-relaxed text-ink-2">{session.notes}</div>}
            </div>
          </Card>
        )}
      </main>
    </div>
  )
}

function VolleyballHistoryCard({ session, onClick, delay = 0 }: { session: ActivitySession; onClick: () => void; delay?: number }) {
  const result = resultLabel(session)
  const tally = volleyballSetTally(session.volleyballSets)
  const metrics = [
    volleyballDirectPoints(session.volleyballStats) > 0 ? `${volleyballDirectPoints(session.volleyballStats)}分` : null,
    session.volleyballStats?.serve?.aces ? `${session.volleyballStats.serve.aces} ACE` : null,
    session.volleyballStats?.dig?.successful ? `${session.volleyballStats.dig.successful}次有效防守` : null,
  ].filter(Boolean).slice(0, 3)
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(delay, 0.3), duration: 0.3 }}>
      <Card onClick={onClick} className="!p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ backgroundColor: `${META.color}22` }}>🏐</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="font-semibold">{fmtDateCN(session.date)}</span>{result && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${result.tone}`}>{result.label} {tally.won}:{tally.lost}</span>}</div>
            <div className="num mt-1 truncate text-xs text-ink-3">{[session.durationMin ? fmtHoursMin(session.durationMin) : null, ...metrics].filter(Boolean).join(' · ') || VOLLEYBALL_SESSION_LABEL[session.volleyballSessionType ?? 'training']}</div>
          </div>
          <span className="text-ink-3">›</span>
        </div>
      </Card>
    </motion.div>
  )
}

function VolleyballRawStats({ stats }: { stats: VolleyballStats }) {
  const groups = [
    { title: '发球', values: [['发球', stats.serve?.attempts], ['ACE', stats.serve?.aces], ['失误', stats.serve?.errors]] },
    { title: '进攻', values: [['进攻', stats.attack?.attempts], ['得分', stats.attack?.points], ['失误', stats.attack?.errors], ['被拦', stats.attack?.blocked]] },
    { title: '拦网', values: [['得分', stats.block?.points], ['有效拦网', stats.block?.effective]] },
    { title: '接发', values: [['接发', stats.reception?.attempts], ['到位', stats.reception?.perfect], ['失误', stats.reception?.errors]] },
    { title: '防守', values: [['防守', stats.dig?.attempts], ['有效', stats.dig?.successful]] },
    { title: '二传', values: [['二传', stats.set?.attempts], ['有效', stats.set?.successful]] },
  ].filter((group) => group.values.some(([, value]) => value !== undefined))
  if (!groups.length) return null
  return <Card><SectionTitle title="专业数据" /><div className="grid grid-cols-2 gap-2">{groups.map((group) => <div key={group.title} className="rounded-2xl bg-surface-2 p-3"><div className="mb-2 text-xs font-semibold">{group.title}</div><div className="space-y-1">{group.values.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={String(label)} className="flex justify-between text-xs"><span className="text-ink-3">{label}</span><span className="num font-medium">{value}</span></div>)}</div></div>)}</div></Card>
}

function FormCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <Card className="space-y-3.5 !p-4"><div><div className="text-[13px] font-semibold text-ink-2">{title}</div>{subtitle && <p className="mt-1 text-xs text-ink-3">{subtitle}</p>}</div>{children}</Card>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-ink-3">{label}</span>{children}</label>
}

function NumberInput({ value, onChange, placeholder = '0', compact = false }: { value?: number; onChange: (value?: number) => void; placeholder?: string; compact?: boolean }) {
  return <input value={value ?? ''} onChange={(e) => { const cleaned = e.target.value.replace(/[^\d]/g, ''); onChange(cleaned === '' ? undefined : Number.parseInt(cleaned, 10)) }} inputMode="numeric" placeholder={placeholder} className={`${INPUT} ${compact ? '!h-10 !px-2 text-center' : ''}`} />
}

function StatGroup({ title, rate, children }: { title: string; rate?: string; children: ReactNode }) {
  return <div><div className="mb-2 flex flex-wrap items-baseline justify-between gap-1"><h3 className="text-sm font-semibold">{title}</h3>{rate && <span className="num text-[10px] text-ink-3">{rate}</span>}</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div></div>
}

function StatInput({ label, value, onChange }: { label: string; value?: number; onChange: (value?: number) => void }) {
  return <Field label={label}><NumberInput value={value} onChange={onChange} /></Field>
}

function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="num text-2xl font-bold">{value}{sub && <span className="ml-1 text-xs font-medium text-ink-3">{sub}</span>}</div><div className="mt-1 text-[11px] text-ink-3">{label}</div></div>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><span className="text-ink-3">{label}</span><span className="text-right font-medium">{value}</span></div>
}

function sessionSummary(session: ActivitySession): string {
  const tally = volleyballSetTally(session.volleyballSets)
  return [
    session.durationMin ? fmtHoursMin(session.durationMin) : null,
    tally.decided ? `局分 ${tally.won}:${tally.lost}` : null,
    volleyballDirectPoints(session.volleyballStats) > 0 ? `${volleyballDirectPoints(session.volleyballStats)} 分` : null,
    session.volleyballPosition ? VOLLEYBALL_POSITION_LABEL[session.volleyballPosition] : null,
  ].filter(Boolean).join(' · ') || '已保存基础记录'
}
