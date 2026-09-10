import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/db'
import type { ActivitySession, DistanceUnit, StrokeType } from '@/db/models'
import { SPORT_META, STROKE_LABEL, STROKE_TYPES } from '@/db/models'
import {
  calcPaceSecPer100m,
  createActivity,
  deleteActivity,
  formatDistance,
  formatPace,
  getActivity,
  getSwimMonthlyDistanceTrend,
  updateActivity,
  type ActivityInput,
} from '@/services/activity'
import { fmtDateCN, fmtDateFullCN, todayStr } from '@/lib/util'
import { BarsChart } from '@/components/charts/charts'
import { Button, Card, SectionTitle, Sheet } from '@/components/ui/basic'
import { toast } from '@/store/settings'
import { Detail } from '@/pages/BadmintonPages'

/** 游泳记录:新建 / 编辑(同一表单复用) */
export function SwimmingFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = !!id
  const LOADING = useMemo(() => Symbol('loading'), [])
  const existing = useLiveQuery(
    () => (id ? getActivity(id) : Promise.resolve(undefined)),
    [id],
    LOADING as unknown as ActivitySession | undefined,
  ) as ActivitySession | undefined | typeof LOADING

  const [f, setF] = useState<ActivityInput & { distanceM?: number; distanceUnit: DistanceUnit; stroke?: StrokeType; poolLengthM?: number; laps?: number; calories?: number }>({
    sport: 'swimming',
    date: todayStr(),
    distanceUnit: 'm',
  })
  /** 距离输入(用户所选单位下的数值);底层 distanceM 统一存米 */
  const [distInput, setDistInput] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editing && existing && existing !== LOADING) {
      const cur = existing as ActivitySession
      const curUnit = cur.distanceUnit ?? 'm'
      setDistInput(cur.distanceM ? String(curUnit === 'mi' ? Math.round((cur.distanceM / 1609.344) * 100) / 100 : cur.distanceM) : '')
      setF({
        sport: 'swimming',
        date: cur.date,
        startTime: cur.startTime,
        durationMin: cur.durationMin,
        distanceUnit: curUnit,
        stroke: cur.stroke,
        poolLengthM: cur.poolLengthM,
        laps: cur.laps,
        calories: cur.calories,
        rpe: cur.rpe,
        venue: cur.venue ?? '',
        notes: cur.notes ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, existing])

  // 自动配速(时长 + 距离 可靠推导,不让用户手填);底层米数 = 输入值按单位换算
  const distanceMFromInput =
    f.distanceUnit === 'mi' ? Math.round(parseFloat(distInput || '0') * 1609.344 * 100) / 100 : parseFloat(distInput || '0') || undefined
  const pace = calcPaceSecPer100m(f.durationMin, distanceMFromInput)

  async function handleSave() {
    if (!f.date) {
      toast('请选择日期', 'error')
      return
    }
    setSaving(true)
    try {
      const payload: ActivityInput = {
        sport: 'swimming',
        date: f.date,
        startTime: f.startTime,
        durationMin: f.durationMin || undefined,
        distanceM: distanceMFromInput,
        distanceUnit: f.distanceUnit,
        stroke: f.stroke,
        poolLengthM: f.poolLengthM || undefined,
        laps: f.laps || undefined,
        calories: f.calories || undefined,
        rpe: f.rpe,
        venue: f.venue?.trim() || undefined,
        notes: f.notes?.trim() || undefined,
      }
      if (editing && id) {
        await updateActivity(id, payload)
        toast('记录已更新')
      } else {
        await createActivity(payload)
        toast('已记录本次游泳 🏊')
      }
      navigate('/swimming', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (editing && id && existing !== LOADING && existing === undefined) {
      toast('记录不存在或已被删除', 'error')
      navigate('/swimming', { replace: true })
    }
  }, [editing, id, existing, navigate, LOADING])

  if (editing && existing === LOADING) {
    return <div className="p-6 text-ink-3">加载中…</div>
  }

  const numInput = (
    key: 'durationMin' | 'distanceM' | 'laps' | 'calories',
    label: string,
    placeholder: string,
    opts: { decimal?: boolean } = {},
  ) => (
    <div key={key}>
      <div className="mb-1.5 text-xs font-medium text-ink-3">{label}</div>
      <input
        value={(f[key] as number | undefined) ?? ''}
        onChange={(e) => {
          const raw = opts.decimal ? e.target.value.replace(/[^\d.]/g, '') : e.target.value.replace(/[^\d]/g, '')
          setF((c) => ({ ...c, [key]: raw === '' ? undefined : parseFloat(raw) }))
        }}
        inputMode="decimal"
        placeholder={placeholder}
        className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
      />
    </div>
  )

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <h1 className="flex-1 text-[17px] font-semibold">{editing ? '编辑游泳记录' : '记录游泳'}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {/* 基本信息 */}
        <Card className="space-y-3.5 !p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">日期</div>
              <input
                type="date"
                value={f.date}
                max={todayStr()}
                onChange={(e) => setF((c) => ({ ...c, date: e.target.value }))}
                className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">开始时间(可选)</div>
              <input
                type="time"
                value={f.startTime ? toTimeStr(f.startTime) : ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return setF((c) => ({ ...c, startTime: undefined }))
                  const [h, m] = v.split(':').map(Number)
                  const d = new Date(`${f.date}T00:00:00`)
                  d.setHours(h, m, 0, 0)
                  setF((c) => ({ ...c, startTime: d.getTime() }))
                }}
                className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numInput('durationMin', '时长(分钟)', '如 45')}
            {numInput('calories', '热量 kcal(可选)', '0')}
          </div>
        </Card>

        {/* 距离 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">距离</div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">游泳距离</div>
              <input
                value={distInput}
                onChange={(e) => setDistInput(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder="如 1000"
                className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
              />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">单位</div>
              <div className="flex rounded-xl bg-surface-2 p-1">
                {(
                  [
                    { v: 'm', label: '米' },
                    { v: 'mi', label: '英里' },
                  ] as { v: DistanceUnit; label: string }[]
                ).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setF((c) => ({ ...c, distanceUnit: o.v }))}
                    className={
                      'rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ' +
                      (f.distanceUnit === o.v ? 'bg-accent text-accent-ink' : 'text-ink-3')
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">泳池长度</div>
              <select
                value={f.poolLengthM ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  setF((c) => ({ ...c, poolLengthM: v === '' || v === 'other' ? undefined : parseFloat(v) }))
                }}
                className="h-11 w-full rounded-xl bg-surface-2 px-2 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              >
                <option value="">不限</option>
                <option value="25">25m</option>
                <option value="50">50m</option>
                <option value="other">其他</option>
              </select>
            </div>
            {numInput('laps', '趟数 / 圈数', '0')}
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">泳姿</div>
              <select
                value={f.stroke ?? ''}
                onChange={(e) => setF((c) => ({ ...c, stroke: (e.target.value || undefined) as StrokeType | undefined }))}
                className="h-11 w-full rounded-xl bg-surface-2 px-2 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              >
                <option value="">不限</option>
                {STROKE_TYPES.map((st) => (
                  <option key={st} value={st}>
                    {STROKE_LABEL[st]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* 自动配速 */}
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5">
            <span className="text-xs text-ink-3">平均配速(自动计算)</span>
            <span className="num text-[15px] font-semibold text-accent">
              {pace ? `${formatPace(pace, f.distanceUnit)}${f.distanceUnit === 'mi' ? ' /mi' : ' /100m'}` : '填写时长与距离后自动算出'}
            </span>
          </div>
        </Card>

        {/* 其他 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">其他(全部可选)</div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">主观强度 RPE(1-10)</div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
                <button
                  key={r}
                  onClick={() => setF((c) => ({ ...c, rpe: c.rpe === r ? undefined : r }))}
                  className={
                    'num size-9 rounded-full text-sm font-medium transition-all active:scale-95 ' +
                    (f.rpe === r ? 'bg-accent font-bold text-accent-ink' : 'bg-surface-2 text-ink-3')
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">场地</div>
            <input
              value={f.venue}
              onChange={(e) => setF((c) => ({ ...c, venue: e.target.value }))}
              placeholder="如:市游泳馆"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">备注</div>
            <textarea
              value={f.notes}
              onChange={(e) => setF((c) => ({ ...c, notes: e.target.value }))}
              placeholder="今天划水感觉 / 训练内容…"
              rows={2}
              className="w-full resize-none rounded-xl bg-surface-2 p-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
        </Card>

        <div className="flex gap-2">
          {editing && id && (
            <Button
              variant="danger"
              className="shrink-0 px-4"
              aria-label="删除记录"
              onClick={async () => {
                if (!confirm('删除这条游泳记录?此操作不可恢复。')) return
                await deleteActivity(id)
                toast('记录已删除')
                navigate('/swimming', { replace: true })
              }}
            >
              <Trash2 size={16} />
            </Button>
          )}
          <Button block size="lg" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : editing ? '保存修改' : '保存记录'}
          </Button>
        </div>
        <p className="pb-4 text-center text-[11px] text-ink-3">除日期外全部可选,配速会根据距离和时长自动计算。</p>
      </main>
    </div>
  )
}

function toTimeStr(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* =============== 游泳统计 + 记录列表(/swimming) =============== */

export function SwimmingPage() {
  const navigate = useNavigate()
  const meta = SPORT_META.swimming

  const sessions = useLiveQuery(
    () => db.activitySessions.where('sport').equals('swimming').sortBy('date').then((rows) => rows.reverse()),
    [],
    undefined,
  )
  const trend = useLiveQuery(async () => {
    return getSwimMonthlyDistanceTrend(6)
  }, [], undefined)

  const stats = useMemo(() => {
    const all = sessions ?? []
    let totalMinutes = 0
    let totalDistanceM = 0
    let maxDistanceM = 0
    let maxDurationMin = 0
    const withDist = all.filter((s) => (s.distanceM ?? 0) > 0)
    const withDur = all.filter((s) => (s.durationMin ?? 0) > 0)
    for (const s of all) {
      totalMinutes += s.durationMin ?? 0
      totalDistanceM += s.distanceM ?? 0
      maxDistanceM = Math.max(maxDistanceM, s.distanceM ?? 0)
      maxDurationMin = Math.max(maxDurationMin, s.durationMin ?? 0)
    }
    const month = new Date().toISOString().slice(0, 7)
    const monthRows = all.filter((s) => s.date.startsWith(month))
    const yearRows = all.filter((s) => s.date.startsWith(String(new Date().getFullYear())))
    return {
      total: all.length,
      totalMinutes,
      totalDistanceM,
      avgDistanceM: withDist.length ? Math.round(totalDistanceM / withDist.length) : null,
      maxDistanceM,
      avgDurationMin: withDur.length ? Math.round(totalMinutes / withDur.length) : null,
      maxDurationMin,
      avgPace: totalDistanceM > 0 && totalMinutes > 0 ? calcPaceSecPer100m(totalMinutes, totalDistanceM) : null,
      monthCount: monthRows.length,
      monthDistanceM: monthRows.reduce((a, s) => a + (s.distanceM ?? 0), 0),
      yearCount: yearRows.length,
      yearDistanceM: yearRows.reduce((a, s) => a + (s.distanceM ?? 0), 0),
    }
  }, [sessions])

  const fmtHours = (min: number) => (min >= 60 ? `${(min / 60).toFixed(1)} 小时` : `${min} 分钟`)

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <h1 className="flex-1 text-[17px] font-semibold">{meta.emoji} 游泳</h1>
          <button
            onClick={() => navigate('/swimming/new')}
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink active:scale-95"
            aria-label="记录游泳"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {/* 统计总览 */}
        <Card className="!p-5">
          <div className="grid grid-cols-2 gap-y-4 text-center">
            <StatCell label="总次数" value={sessions ? String(stats.total) : '…'} />
            <StatCell label="总时长" value={sessions ? fmtHours(stats.totalMinutes) : '…'} />
            <StatCell label="总距离" value={sessions ? formatDistance(stats.totalDistanceM) : '…'} />
            <StatCell label="平均配速" value={stats.avgPace ? `${formatPace(stats.avgPace)}/100m` : '—'} />
          </div>
          {stats.total > 0 && (
            <div className="num mt-4 flex justify-around rounded-2xl bg-surface-2 py-2.5 text-center text-xs text-ink-3">
              <span>均次 {formatDistance(stats.avgDistanceM ?? undefined)}</span>
              <span>最长 {formatDistance(stats.maxDistanceM || undefined)}</span>
              <span>均次 {fmtHours(stats.avgDurationMin ?? 0)}</span>
            </div>
          )}
        </Card>

        {/* 本月/年度 */}
        {stats.total > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Card className="!p-4 text-center">
              <div className="num text-xl font-bold">{stats.monthCount}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">本月次数</div>
              <div className="num mt-1 text-sm font-medium text-ink-2">{formatDistance(stats.monthDistanceM)}</div>
            </Card>
            <Card className="!p-4 text-center">
              <div className="num text-xl font-bold">{stats.yearCount}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">年度次数</div>
              <div className="num mt-1 text-sm font-medium text-ink-2">{formatDistance(stats.yearDistanceM)}</div>
            </Card>
          </div>
        )}

        {/* 月度距离趋势 */}
        {sessions !== undefined && sessions.length > 0 && (
          <Card>
            <SectionTitle title="近 6 个月距离" />
            <BarsChart
              data={(trend ?? []).map((t) => ({ x: `${parseInt(t.month.slice(5), 10)}月`, y: Math.round(t.distanceM) }))}
              height={130}
              valueFormatter={(v) => formatDistance(v)}
            />
          </Card>
        )}

        {/* 记录列表 */}
        <SectionTitle title="记录" />
        {sessions !== undefined && sessions.length === 0 && (
          <Card className="!p-8 text-center">
            <div className="mb-2 text-3xl">🏊</div>
            <p className="font-semibold">还没有游泳记录</p>
            <p className="mx-auto mt-1 max-w-60 text-sm leading-relaxed text-ink-3">
              记下距离和时长,配速和月度距离趋势自动算出来。
            </p>
            <Button className="mt-5" onClick={() => navigate('/swimming/new')}>
              <Plus size={16} /> 记录第一次
            </Button>
          </Card>
        )}
        <div className="space-y-2">
          {sessions?.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.3 }}
            >
              <Card onClick={() => navigate(`/swimming/${s.id}/edit`)} className="!p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ backgroundColor: `${meta.color}1f` }}>
                    {meta.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] font-semibold">{fmtDateCN(s.date)}</span>
                      {s.stroke && <span className="text-xs text-ink-3">{STROKE_LABEL[s.stroke]}</span>}
                    </div>
                    <div className="num mt-0.5 truncate text-[13px] text-ink-3">
                      {[
                        s.distanceM ? formatDistance(s.distanceM, s.distanceUnit ?? 'm') : null,
                        s.durationMin ? `${s.durationMin} 分钟` : null,
                        calcPaceSecPer100m(s.durationMin, s.distanceM)
                          ? `配速 ${formatPace(calcPaceSecPer100m(s.durationMin, s.distanceM), s.distanceUnit ?? 'm')}/100m`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="num text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-3">{label}</div>
    </div>
  )
}

/** 游泳记录详情(列表页 Sheet) */
export function SwimmingDetailSheet({
  session,
  onClose,
  onEdit,
}: {
  session: ActivitySession | null
  onClose: () => void
  onEdit: (s: ActivitySession) => void
}) {
  const navigate = useNavigate()
  return (
    <Sheet open={!!session} onClose={onClose} title={session ? `${meta_emoji} ${fmtDateFullCN(session.date)}` : ''}>
      {session && (
        <div className="space-y-4 pb-6">
          <Card className="!p-4">
            <div className="grid grid-cols-2 gap-y-3 text-center">
              {session.durationMin ? <Detail label="时长" value={`${session.durationMin} 分钟`} /> : null}
              {session.distanceM ? <Detail label="距离" value={formatDistance(session.distanceM, session.distanceUnit ?? 'm')} /> : null}
              {session.stroke && <Detail label="泳姿" value={STROKE_LABEL[session.stroke]} />}
              {session.poolLengthM ? <Detail label="泳池" value={`${session.poolLengthM}m`} /> : null}
              {session.laps ? <Detail label="趟数" value={String(session.laps)} /> : null}
              {session.durationMin && session.distanceM ? (
                <Detail
                  label="平均配速"
                  value={`${formatPace(calcPaceSecPer100m(session.durationMin, session.distanceM), session.distanceUnit ?? 'm')}${session.distanceUnit === 'mi' ? '/mi' : '/100m'}`}
                />
              ) : null}
              {session.calories ? <Detail label="热量" value={`${session.calories} kcal`} /> : null}
              {session.rpe ? <Detail label="RPE" value={String(session.rpe)} /> : null}
            </div>
            {session.venue && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">场地:{session.venue}</p>}
            {session.notes && <p className="mt-2 border-t border-line pt-3 text-sm leading-relaxed text-ink-2">{session.notes}</p>}
          </Card>
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="shrink-0 px-4"
              aria-label="删除记录"
              onClick={async () => {
                if (!confirm('删除这条游泳记录?此操作不可恢复。')) return
                await deleteActivity(session.id)
                toast('记录已删除')
                onClose()
                navigate('/swimming', { replace: true })
              }}
            >
              <Trash2 size={16} />
            </Button>
            <Button variant="secondary" block onClick={() => onEdit(session)}>
              编辑
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

const meta_emoji = SPORT_META.swimming.emoji
