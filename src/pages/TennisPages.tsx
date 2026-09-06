import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/db'
import type { ActivitySession } from '@/db/models'
import { SPORT_META } from '@/db/models'
import { createActivity, deleteActivity, getActivity, updateActivity, type ActivityInput } from '@/services/activity'
import { fmtDateCN } from '@/lib/util'
import { BarsChart } from '@/components/charts/charts'
import { Button, Card, SectionTitle } from '@/components/ui/basic'
import { toast } from '@/store/settings'

/** 网球记录:新建 / 编辑(同一表单复用) */
export function TennisFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = !!id
  const LOADING = useMemo(() => Symbol('loading'), [])
  const existing = useLiveQuery(
    () => (id ? getActivity(id) : Promise.resolve(undefined)),
    [id],
    LOADING as unknown as ActivitySession | undefined,
  ) as ActivitySession | undefined | typeof LOADING

  const [f, setF] = useState<ActivityInput & { scoreText?: string }>({
    sport: 'tennis',
    date: new Date().toISOString().slice(0, 10),
    playType: 'singles',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editing && existing && existing !== LOADING) {
      const cur = existing as ActivitySession
      setF({
        sport: 'tennis',
        date: cur.date,
        startTime: cur.startTime,
        durationMin: cur.durationMin,
        playType: cur.playType ?? 'singles',
        partners: cur.partners ?? '',
        venue: cur.venue ?? '',
        isMatch: cur.isMatch,
        score: cur.score ?? {},
        scoreText: cur.scoreText ?? '',
        rpe: cur.rpe,
        notes: cur.notes ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, existing])

  useEffect(() => {
    if (editing && id && existing !== LOADING && existing === undefined) {
      toast('记录不存在或已被删除', 'error')
      navigate('/tennis', { replace: true })
    }
  }, [editing, id, existing, navigate, LOADING])

  if (editing && existing === LOADING) {
    return <div className="p-6 text-ink-3">加载中…</div>
  }

  const score = f.score ?? {}
  const setScore = (patch: Partial<NonNullable<ActivityInput['score']>>) =>
    setF((c) => ({ ...c, score: { ...curScore(c.score), ...patch } }))
  const curScore = (sc?: ActivitySession['score']) => sc ?? {}

  // 自动算总盘数:填了胜负且总盘数为空时自动带出(与羽毛球表单行为一致)
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
      const payload: ActivityInput & { scoreText?: string } = {
        ...f,
        venue: f.venue?.trim() || undefined,
        partners: f.partners?.trim() || undefined,
        notes: f.notes?.trim() || undefined,
        scoreText: f.scoreText?.trim() || undefined,
        score: {
          gamesTotal: score.gamesTotal || undefined,
          gamesWon: score.gamesWon || undefined,
          gamesLost: score.gamesLost || undefined,
          pointsTotal: undefined,
        },
      }
      if (editing && id) {
        await updateActivity(id, payload)
        toast('记录已更新')
      } else {
        await createActivity(payload)
        toast('已记录本次网球 🎾')
      }
      navigate('/tennis', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const numField = (label: string, key: 'gamesTotal' | 'gamesWon' | 'gamesLost', placeholder: string) => (
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
          <h1 className="flex-1 text-[17px] font-semibold">{editing ? '编辑网球记录' : '记录网球'}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <Card className="space-y-3.5 !p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-3">日期</div>
              <input
                type="date"
                value={f.date}
                max={new Date().toISOString().slice(0, 10)}
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
                  { v: 'singles', label: '单打' },
                  { v: 'doubles', label: '双打' },
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
            {numField('总盘数', 'gamesTotal', '0')}
            {numField('胜盘', 'gamesWon', '0')}
            {numField('负盘', 'gamesLost', '0')}
          </div>
          {scoreMismatch && <p className="text-xs text-warn">胜盘 + 负盘 与总盘数不一致,请确认一下。</p>}
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">比分(可选)</div>
            <input
              value={f.scoreText}
              onChange={(e) => setF((c) => ({ ...c, scoreText: e.target.value }))}
              placeholder="如:6-4 3-6 7-5"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
        </Card>

        {/* 其他 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">其他(全部可选)</div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">对手 / 搭档</div>
            <input
              value={f.partners}
              onChange={(e) => setF((c) => ({ ...c, partners: e.target.value }))}
              placeholder="如:vs 老张 / 和小李双打"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">场地</div>
            <input
              value={f.venue}
              onChange={(e) => setF((c) => ({ ...c, venue: e.target.value }))}
              placeholder="如:小区网球场"
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
              placeholder="今天发球状态 / 底线对拉…"
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
                if (!confirm('删除这条网球记录?此操作不可恢复。')) return
                await deleteActivity(id)
                toast('记录已删除')
                navigate('/tennis', { replace: true })
              }}
            >
              <Trash2 size={16} />
            </Button>
          )}
          <Button block size="lg" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : editing ? '保存修改' : '保存记录'}
          </Button>
        </div>
        <p className="pb-4 text-center text-[11px] text-ink-3">除日期外全部可选,随手记一盘胜负也可以。</p>
      </main>
    </div>
  )
}

function toTimeStr(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* =============== 网球统计 + 记录列表(/tennis) =============== */

export function TennisPage() {
  const navigate = useNavigate()
  const meta = SPORT_META.tennis

  const sessions = useLiveQuery(
    () => db.activitySessions.where('sport').equals('tennis').sortBy('date').then((rows) => rows.reverse()),
    [],
    undefined,
  )
  const trend = useLiveQuery(async () => {
    const { getSportMonthlyTrend } = await import('@/services/activity')
    return getSportMonthlyTrend('tennis', 6)
  }, [], undefined)

  const stats = useMemo(() => {
    const all = sessions ?? []
    let totalMinutes = 0
    let setsWon = 0
    let setsLost = 0
    let wins = 0
    let losses = 0
    const month = new Date().toISOString().slice(0, 7)
    let monthCount = 0
    for (const s of all) {
      totalMinutes += s.durationMin ?? 0
      setsWon += s.score?.gamesWon ?? 0
      setsLost += s.score?.gamesLost ?? 0
      const w = s.score?.gamesWon ?? 0
      const l = s.score?.gamesLost ?? 0
      if (w > 0 || l > 0) {
        if (w > l) wins++
        else if (l > w) losses++
      }
      if (s.date.startsWith(month)) monthCount++
    }
    return {
      total: all.length,
      totalMinutes,
      setsWon,
      setsLost,
      winRate: setsWon + setsLost > 0 ? Math.round((setsWon / (setsWon + setsLost)) * 1000) / 10 : null,
      wins,
      losses,
      monthCount,
    }
  }, [sessions])

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <h1 className="flex-1 text-[17px] font-semibold">{meta.emoji} 网球</h1>
          <button
            onClick={() => navigate('/tennis/new')}
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink active:scale-95"
            aria-label="记录网球"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <Card className="!p-5">
          <div className="grid grid-cols-2 gap-y-4 text-center">
            <div>
              <div className="num text-2xl font-bold">{sessions ? String(stats.total) : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总场次</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{sessions ? fmtHours(stats.totalMinutes) : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总时长</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">
                {stats.setsWon + stats.setsLost > 0 ? `${stats.setsWon}:${stats.setsLost}` : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">盘数 胜:负</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{stats.winRate !== null ? `${stats.winRate}%` : '—'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">盘胜率</div>
            </div>
          </div>
          {stats.total > 0 && (
            <div className="num mt-4 flex justify-around rounded-2xl bg-surface-2 py-2.5 text-center text-xs text-ink-3">
              <span>胜场 {stats.wins} · 负场 {stats.losses}</span>
              <span>本月 {stats.monthCount} 次</span>
            </div>
          )}
        </Card>

        {sessions !== undefined && sessions.length > 0 && (
          <Card>
            <SectionTitle title="近 6 个月" />
            <BarsChart data={(trend ?? []).map((t) => ({ x: `${parseInt(t.month.slice(5), 10)}月`, y: t.sessions }))} height={130} />
          </Card>
        )}

        <SectionTitle title="记录" />
        {sessions !== undefined && sessions.length === 0 && (
          <Card className="!p-8 text-center">
            <div className="mb-2 text-3xl">🎾</div>
            <p className="font-semibold">还没有网球记录</p>
            <p className="mx-auto mt-1 max-w-60 text-sm leading-relaxed text-ink-3">
              打完记一下盘数胜负,就能看到胜率和出场次数的变化。
            </p>
            <Button className="mt-5" onClick={() => navigate('/tennis/new')}>
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
              <Card onClick={() => navigate(`/tennis/${s.id}/edit`)} className="!p-4">
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
                    <div className="num mt-0.5 truncate text-[13px] text-ink-3">
                      {[
                        s.playType === 'singles' ? '单打' : s.playType === 'doubles' ? '双打' : null,
                        (s.score?.gamesTotal ?? 0) > 0 ? `${s.score?.gamesTotal} 盘 · 胜 ${s.score?.gamesWon} : 负 ${s.score?.gamesLost}` : null,
                        s.scoreText,
                        s.durationMin ? `${s.durationMin} 分钟` : null,
                        s.venue,
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

function fmtHours(min: number): string {
  return min >= 60 ? `${(min / 60).toFixed(1)} 小时` : `${min} 分钟`
}
