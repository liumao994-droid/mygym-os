import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Plus, Trash2, Pencil } from 'lucide-react'
import { db } from '@/db/db'
import type { ActivitySession } from '@/db/models'
import { SPORT_META } from '@/db/models'
import { calcPaceSecPer100m, createActivity, deleteActivity, formatDistance, formatPace, getActivity, updateActivity, type ActivityInput } from '@/services/activity'
import { STROKE_LABEL, type StrokeType } from '@/db/models'
import { fmtDateCN, fmtDateFullCN, parseLocalDate, todayStr } from '@/lib/util'
import { BarsChart } from '@/components/charts/charts'
import { Button, Card, SectionTitle, Sheet } from '@/components/ui/basic'
import { toast } from '@/store/settings'

/** 加载中哨兵:区分 liveQuery 未出快照与记录确实不存在 */
const LOADING = Symbol('loading')

/** 羽毛球记录:新建 / 编辑(同一表单复用) */
export function BadmintonFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = !!id
  const existing = useLiveQuery(
    () => (id ? getActivity(id) : Promise.resolve(undefined)),
    [id],
    LOADING as unknown as ActivitySession | undefined,
  ) as ActivitySession | undefined | typeof LOADING
  const [saving, setSaving] = useState(false)

  const [f, setF] = useState<ActivityInput>({
    sport: 'badminton',
    date: todayStr(),
    startTime: undefined,
    durationMin: undefined,
    venue: '',
    playType: 'doubles',
    partners: '',
    isMatch: undefined,
    score: {},
    rpe: undefined,
    notes: '',
  })

  useEffect(() => {
    if (editing && existing && existing !== LOADING) {
      setF({
        sport: existing.sport,
        date: existing.date,
        startTime: existing.startTime,
        durationMin: existing.durationMin,
        venue: existing.venue ?? '',
        playType: existing.playType ?? 'doubles',
        partners: existing.partners ?? '',
        isMatch: existing.isMatch,
        score: existing.score ?? {},
        rpe: existing.rpe,
        notes: existing.notes ?? '',
      })
    }
  }, [editing, existing])

  const score = f.score ?? {}
  const setScore = (patch: Partial<NonNullable<ActivityInput['score']>>) =>
    setF((cur) => ({ ...cur, score: { ...cur.score, ...patch } }))

  // 填了胜负且总为空/不一致时,自动带出总数(用户仍可改)
  useEffect(() => {
    const w = score.gamesWon
    const l = score.gamesLost
    if ((w !== undefined || l !== undefined) && score.gamesTotal === undefined) {
      setScore({ gamesTotal: (w ?? 0) + (l ?? 0) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score.gamesWon, score.gamesLost])

  const scoreMismatch =
    score.gamesTotal !== undefined &&
    (score.gamesWon ?? 0) + (score.gamesLost ?? 0) > 0 &&
    (score.gamesWon ?? 0) + (score.gamesLost ?? 0) !== score.gamesTotal

  async function handleSave() {
    if (!f.date) {
      toast('请选择日期', 'error')
      return
    }
    setSaving(true)
    try {
      // startTime 的日期部分跟随所选日期(避免先填时间再改日期导致时间戳错位)
      let normalizedStart = f.startTime
      if (normalizedStart !== undefined) {
        const d = parseLocalDate(f.date || todayStr())
        const t = new Date(normalizedStart)
        d.setHours(t.getHours(), t.getMinutes(), 0, 0)
        normalizedStart = d.getTime()
      }
      const payload: ActivityInput = {
        ...f,
        startTime: normalizedStart,
        venue: f.venue?.trim() || undefined,
        partners: f.partners?.trim() || undefined,
        notes: f.notes?.trim() || undefined,
        score: {
          gamesTotal: score.gamesTotal || undefined,
          gamesWon: score.gamesWon || undefined,
          gamesLost: score.gamesLost || undefined,
          pointsTotal: score.pointsTotal || undefined,
        },
      }
      if (editing && id) {
        await updateActivity(id, payload)
        toast('记录已更新')
      } else {
        await createActivity(payload)
        toast('已记录本次羽毛球 🏸')
      }
      navigate('/badminton', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (editing && id && existing !== LOADING && existing === undefined) {
      toast('记录不存在或已被删除', 'error')
      navigate('/badminton', { replace: true })
    }
  }, [editing, id, existing, navigate])

  if (editing && existing === LOADING) {
    return <div className="p-6 text-ink-3">加载中…</div>
  }

  const numField = (
    label: string,
    key: 'gamesTotal' | 'gamesWon' | 'gamesLost' | 'pointsTotal',
    placeholder: string,
  ) => (
    <div key={key}>
      <div className="mb-1.5 text-xs font-medium text-ink-3">{label}</div>
      <input
        value={score[key] ?? ''}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d]/g, '')
          setScore({ [key]: v === '' ? undefined : parseInt(v, 10) } as never)
        }}
        inputMode="numeric"
        placeholder={placeholder}
        className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-center text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
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
          <h1 className="flex-1 text-[17px] font-semibold">{editing ? '编辑羽毛球记录' : '记录羽毛球'}</h1>
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
                  const d = parseLocalDate(f.date || todayStr())
                  d.setHours(h, m, 0, 0)
                  setF((c) => ({ ...c, startTime: d.getTime() }))
                }}
                className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">持续时长(分钟,可选)</div>
            <input
              value={f.durationMin ?? ''}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, '')
                setF((c) => ({ ...c, durationMin: v === '' ? undefined : parseInt(v, 10) }))
              }}
              inputMode="numeric"
              placeholder="如 90"
              className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
        </Card>

        {/* 对局 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">对局</div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">单打 / 双打</div>
            <div className="flex rounded-xl bg-surface-2 p-1">
              {(
                [
                  { v: 'doubles', label: '双打' },
                  { v: 'singles', label: '单打' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setF((c) => ({ ...c, playType: o.v }))}
                  className={
                    'flex-1 rounded-lg py-2 text-sm font-medium transition-colors ' +
                    (f.playType === o.v ? 'bg-accent text-accent-ink' : 'text-ink-3')
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {numField('总局数', 'gamesTotal', '0')}
            {numField('胜局', 'gamesWon', '0')}
            {numField('负局', 'gamesLost', '0')}
          </div>
          {scoreMismatch && (
            <p className="text-xs text-warn">胜局 + 负局 与总局数不一致,请确认一下。</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {numField('总得分(可选)', 'pointsTotal', '0')}
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">是否比赛</div>
              <button
                onClick={() => setF((c) => ({ ...c, isMatch: c.isMatch ? undefined : 1 }))}
                className={
                  'flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium transition-colors ' +
                  (f.isMatch ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-3 ring-1 ring-line')
                }
              >
                {f.isMatch ? '是比赛' : '日常练习'}
              </button>
            </div>
          </div>
        </Card>

        {/* 其他 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">其他(全部可选)</div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">场地</div>
            <input
              value={f.venue}
              onChange={(e) => setF((c) => ({ ...c, venue: e.target.value }))}
              placeholder="如:市体育中心"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">对手 / 搭档</div>
            <input
              value={f.partners}
              onChange={(e) => setF((c) => ({ ...c, partners: e.target.value }))}
              placeholder="如:和小王双打"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">主观强度 RPE(可选)</div>
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
            <div className="mb-1.5 text-xs font-medium text-ink-3">备注</div>
            <textarea
              value={f.notes}
              onChange={(e) => setF((c) => ({ ...c, notes: e.target.value }))}
              placeholder="今天状态 / 有趣的回合…"
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
                if (!confirm('删除这条羽毛球记录?此操作不可恢复。')) return
                await deleteActivity(id)
                toast('记录已删除')
                navigate('/badminton', { replace: true })
              }}
            >
              <Trash2 size={16} />
            </Button>
          )}
          <Button block size="lg" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : editing ? '保存修改' : '保存记录'}
          </Button>
        </div>
        <p className="pb-4 text-center text-[11px] text-ink-3">除日期外全部可选,随手记一两个数字也可以保存。</p>
      </main>
    </div>
  )
}

function toTimeStr(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* =============== 羽毛球统计 + 记录列表(/badminton) =============== */

export function BadmintonPage() {
  const navigate = useNavigate()
  const meta = SPORT_META.badminton
  const [detailActivity, setDetailActivity] = useState<ActivitySession | null>(null)

  const sessions = useLiveQuery(
    () => db.activitySessions.where('sport').equals('badminton').sortBy('date').then((rows) => rows.reverse()),
    [],
    undefined,
  )
  const trend = useLiveQuery(async () => {
    const { getSportMonthlyTrend } = await import('@/services/activity')
    return getSportMonthlyTrend('badminton', 6)
  }, [], undefined)

  const stats = useMemo(() => {
    const all = sessions ?? []
    let totalMinutes = 0
    let gamesWon = 0
    let gamesLost = 0
    let wins = 0
    let losses = 0
    const month = new Date().toISOString().slice(0, 7)
    let monthCount = 0
    let monthMinutes = 0
    for (const s of all) {
      totalMinutes += s.durationMin ?? 0
      gamesWon += s.score?.gamesWon ?? 0
      gamesLost += s.score?.gamesLost ?? 0
      const w = s.score?.gamesWon ?? 0
      const l = s.score?.gamesLost ?? 0
      if (w > 0 || l > 0) {
        if (w > l) wins++
        else if (l > w) losses++
      }
      if (s.date.startsWith(month)) {
        monthCount++
        monthMinutes += s.durationMin ?? 0
      }
    }
    return {
      total: all.length,
      totalMinutes,
      gamesWon,
      gamesLost,
      winRate: gamesWon + gamesLost > 0 ? Math.round((gamesWon / (gamesWon + gamesLost)) * 1000) / 10 : null,
      wins,
      losses,
      monthCount,
      monthMinutes,
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
          <h1 className="flex-1 text-[17px] font-semibold">{meta.emoji} 羽毛球</h1>
          <button
            onClick={() => navigate('/badminton/new')}
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink active:scale-95"
            aria-label="记录羽毛球"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {/* 统计总览 */}
        <Card className="!p-5">
          <div className="grid grid-cols-2 gap-y-4 text-center">
            <div>
              <div className="num text-2xl font-bold">{sessions ? stats.total : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总场次</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{sessions ? fmtHours(stats.totalMinutes) : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总运动时间</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">
                {stats.gamesWon + stats.gamesLost > 0 ? `${stats.gamesWon}:${stats.gamesLost}` : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">局数 胜:负</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{stats.winRate !== null ? `${stats.winRate}%` : '—'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">局胜率</div>
            </div>
          </div>
          {stats.total > 0 && (
            <div className="num mt-4 flex justify-around rounded-2xl bg-surface-2 py-2.5 text-center text-xs text-ink-3">
              <span>胜场 {stats.wins} · 负场 {stats.losses}</span>
              <span>本月 {stats.monthCount} 次 · {fmtHours(stats.monthMinutes)}</span>
            </div>
          )}
        </Card>

        {/* 月度趋势 */}
        {sessions !== undefined && sessions.length > 0 && (
          <Card>
            <SectionTitle title="近 6 个月" />
            <BarsChart data={(trend ?? []).map((t) => ({ x: `${parseInt(t.month.slice(5), 10)}月`, y: t.sessions }))} height={130} />
          </Card>
        )}

        {/* 记录列表 */}
        <SectionTitle title="记录" />
        {sessions !== undefined && sessions.length === 0 && (
          <Card className="!p-8 text-center">
            <div className="mb-2 text-3xl">🏸</div>
            <p className="font-semibold">还没有羽毛球记录</p>
            <p className="mx-auto mt-1 max-w-60 text-sm leading-relaxed text-ink-3">
              打完球随手记一下局数和时长,就能看到胜率和运动时间的变化。
            </p>
            <Button className="mt-5" onClick={() => navigate('/badminton/new')}>
              <Plus size={16} /> 记录第一场
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
              <Card onClick={() => setDetailActivity(s)} className="!p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ backgroundColor: `${meta.color}1f` }}>
                    {meta.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] font-semibold">{fmtDateCN(s.date)}</span>
                      {s.isMatch === 1 && (
                        <span className="rounded-full bg-pr/15 px-2 py-0.5 text-[10px] font-medium text-pr">比赛</span>
                      )}
                    </div>
                    <div className="num mt-0.5 truncate text-[13px] text-ink-3">{describeSession(s)}</div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        <ActivityDetailSheet
          session={detailActivity}
          onClose={() => setDetailActivity(null)}
          onEdit={(a: ActivitySession) => {
            setDetailActivity(null)
            navigate(`/badminton/${a.id}/edit`)
          }}
        />
      </main>
    </div>
  )
}

export function describeSession(s: ActivitySession): string {
  const parts: string[] = []
  if (s.sport === 'badminton' && s.playType) parts.push(s.playType === 'singles' ? '单打' : '双打')
  const g = s.score ?? {}
  if ((g.gamesTotal ?? 0) > 0) {
    parts.push(`${g.gamesTotal} 局`)
    if ((g.gamesWon ?? 0) > 0 || (g.gamesLost ?? 0) > 0) parts.push(`胜 ${g.gamesWon ?? 0} : 负 ${g.gamesLost ?? 0}`)
  }
  if (s.durationMin) parts.push(`${s.durationMin} 分钟`)
  if (s.venue) parts.push(s.venue)
  if (parts.length === 0) parts.push('羽毛球')
  return parts.join(' · ')
}

/** 运动记录详情(通用:按运动类型渲染字段;列表页 Sheet 内展示 + 编辑/删除) */
export function ActivityDetailSheet({
  session,
  onClose,
  onEdit,
}: {
  session: ActivitySession | null
  onClose: () => void
  onEdit: (s: ActivitySession) => void
}) {
  const navigate = useNavigate()
  const meta = (session ? SPORT_META[session.sport as keyof typeof SPORT_META] : undefined) ?? SPORT_META.badminton
  return (
    <Sheet open={!!session} onClose={onClose} title={session ? `${meta.emoji} ${fmtDateFullCN(session.date)}` : ''}>
      {session && (
        <div className="space-y-4 pb-6">
          <Card className="!p-4">
            <div className="grid grid-cols-2 gap-y-3 text-center">
              {session.sport === 'badminton' && session.playType && (
                <Detail label="类型" value={session.playType === 'singles' ? '单打' : '双打'} />
              )}
              {session.durationMin ? <Detail label="时长" value={`${session.durationMin} 分钟`} /> : null}
              {session.sport === 'badminton' && (session.score?.gamesTotal ?? 0) > 0 && (
                <Detail label="总局数" value={String(session.score?.gamesTotal)} />
              )}
              {session.sport === 'tennis' && (session.score?.gamesTotal ?? 0) > 0 && (
                <Detail label="总盘数" value={String(session.score?.gamesTotal)} />
              )}
              {((session.sport === 'badminton' || session.sport === 'tennis')) &&
              ((session.score?.gamesWon ?? 0) > 0 || (session.score?.gamesLost ?? 0) > 0) ? (
                <Detail label="胜负" value={`${session.score?.gamesWon ?? 0} : ${session.score?.gamesLost ?? 0}`} />
              ) : null}
              {session.sport === 'tennis' && session.scoreText ? (
                <Detail label="比分" value={session.scoreText} />
              ) : null}
              {session.sport === 'tennis' && session.indoor && (
                <Detail label="室内外" value={session.indoor === 'indoor' ? '室内' : '室外'} />
              )}
              {session.sport === 'tennis' && session.surface && (
                <Detail
                  label="场地类型"
                  value={session.surface === 'hard' ? '硬地' : session.surface === 'clay' ? '红土' : session.surface === 'grass' ? '草地' : '其他'}
                />
              )}
              {session.sport === 'tennis' && session.nature && (
                <Detail
                  label="性质"
                  value={
                    { training: '训练', official: '正式比赛', friendly: '友谊赛', practice: '练习赛', serving: '发球训练', multiball: '多球训练', other: '其他' }[
                      session.nature
                    ]
                  }
                />
              )}
              {session.sport === 'tennis' && session.trainingTypes && session.trainingTypes.length > 0 && (
                <Detail label="训练类型" value={session.trainingTypes.join(' + ')} />
              )}
              {session.sport === 'badminton' && session.score?.pointsTotal ? (
                <Detail label="总得分" value={String(session.score.pointsTotal)} />
              ) : null}
              {session.sport === 'swimming' && session.distanceM ? (
                <Detail label="距离" value={formatDistance(session.distanceM, session.distanceUnit ?? 'm')} />
              ) : null}
              {session.sport === 'swimming' && session.stroke && (
                <Detail label="泳姿" value={STROKE_LABEL[session.stroke as StrokeType] ?? '其他'} />
              )}
              {session.sport === 'swimming' && session.poolLengthM ? (
                <Detail label="泳池" value={`${session.poolLengthM}m`} />
              ) : null}
              {session.sport === 'swimming' && session.laps ? <Detail label="趟数" value={String(session.laps)} /> : null}
              {session.sport === 'swimming' && session.durationMin && session.distanceM ? (
                <Detail
                  label="平均配速"
                  value={`${formatPace(calcPaceSecPer100m(session.durationMin, session.distanceM), session.distanceUnit ?? 'm')}/100m`}
                />
              ) : null}
              {session.sport === 'swimming' && session.calories ? (
                <Detail label="热量" value={`${session.calories} kcal`} />
              ) : null}
              {session.rpe ? <Detail label="RPE" value={String(session.rpe)} /> : null}
              {session.isMatch === 1 && <Detail label="性质" value="比赛" />}
            </div>
            {session.sets && session.sets.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 text-[11px] text-ink-3">每盘比分</div>
                <div className="num flex flex-wrap gap-2">
                  {session.sets.map((x, i) => (
                    <span key={i} className="num rounded-lg bg-surface-2 px-2.5 py-1 text-[13px] font-medium">
                      S{i + 1}: {Number.isFinite(x.a) ? x.a : '?'}-{Number.isFinite(x.b) ? x.b : '?'}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {session.technique && Object.values(session.technique).some((v) => v !== undefined && v !== null) && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 text-[11px] text-ink-3">技术统计</div>
                <div className="num grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      { label: 'Ace', key: 'aces' },
                      { label: '双误', key: 'doubleFaults' },
                      { label: '制胜分', key: 'winners' },
                      { label: '失误', key: 'unforcedErrors' },
                      { label: '破发成功', key: 'breakConverted' },
                      { label: '一发成功', key: 'firstServeIn' },
                    ] as const
                  ).map((o) => {
                    const v = session.technique?.[o.key]
                    return v === undefined || v === null ? null : (
                      <div key={o.key} className="rounded-xl bg-surface-2 py-2">
                        <div className="num text-[15px] font-bold">{v}</div>
                        <div className="text-[10px] text-ink-3">{o.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {session.fitness && Object.values(session.fitness).some((v) => v !== undefined && v !== null) && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 text-[11px] text-ink-3">体能</div>
                <div className="num flex flex-wrap gap-2">
                  {session.fitness.runMinutes ? <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs">跑动 {session.fitness.runMinutes} 分</span> : null}
                  {session.fitness.runDistanceM ? <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs">跑动 {session.fitness.runDistanceM} m</span> : null}
                  {session.fitness.avgHr ? <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs">均心率 {session.fitness.avgHr}</span> : null}
                  {session.fitness.maxHr ? <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs">最大心率 {session.fitness.maxHr}</span> : null}
                </div>
              </div>
            )}
            {session.trainingFocus && session.sport === 'tennis' && (
              <p className="mt-3 text-sm text-ink-2">训练内容:{session.trainingFocus}</p>
            )}
            {session.venue && (
              <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">场地:{session.venue}</p>
            )}
            {session.partners && (
              <p className="mt-1 text-sm text-ink-2">对手/搭档:{session.partners}</p>
            )}
            {session.notes && (
              <p className="mt-2 border-t border-line pt-3 text-sm leading-relaxed text-ink-2">{session.notes}</p>
            )}
          </Card>
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="shrink-0 px-4"
              aria-label="删除记录"
              onClick={async () => {
                if (!session || !confirm('删除这条羽毛球记录?此操作不可恢复。')) return
                await deleteActivity(session.id)
                toast('记录已删除')
                onClose()
                navigate('/badminton', { replace: true })
              }}
            >
              <Trash2 size={16} />
            </Button>
            <Button variant="secondary" block onClick={() => onEdit(session)}>
              <Pencil size={15} /> 编辑
            </Button>
          </div>
          <p className="text-center text-[11px] text-ink-3">
            记录于 {fmtDateFullCN(session.date)}{session.startTime ? ` ${fmtTime(session.startTime)}` : ''}
          </p>
        </div>
      )}
    </Sheet>
  )
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold">{value}</div>
    </div>
  )
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

