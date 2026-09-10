import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/db'
import type { ActivitySession } from '@/db/models'
import { SPORT_META } from '@/db/models'
import { createActivity, deleteActivity, getActivity, getTennisMonthlyTrend, getTennisStats, updateActivity, type ActivityInput } from '@/services/activity'
import { fmtDateCN, parseLocalDate, todayStr } from '@/lib/util'
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
    date: todayStr(),
    playType: 'singles',
  })
  const [sets, setSets] = useState<{ a: number; b: number }[]>([])
  const [technique, setTechnique] = useState<NonNullable<ActivityInput['technique']>>({})
  const [fitness, setFitness] = useState<NonNullable<ActivityInput['fitness']>>({})
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
        indoor: cur.indoor,
        surface: cur.surface,
        nature: cur.nature,
        trainingTypes: cur.trainingTypes ?? [],
        trainingFocus: cur.trainingFocus ?? '',
        isMatch: cur.isMatch,
        score: cur.score ?? {},
        scoreText: cur.scoreText ?? '',
        rpe: cur.rpe,
        notes: cur.notes ?? '',
      })
      setSets(cur.sets ?? [])
      setTechnique(cur.technique ?? {})
      setFitness(cur.fitness ?? {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, existing])

  useEffect(() => {
    if (editing && id && existing !== LOADING && existing === undefined) {
      toast('记录不存在或已被删除', 'error')
      navigate('/tennis', { replace: true })
    }
  }, [editing, id, existing, navigate, LOADING])

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

  if (editing && existing === LOADING) {
    return <div className="p-6 text-ink-3">加载中…</div>
  }

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
      const payload: ActivityInput & { scoreText?: string } = {
        ...f,
        startTime: normalizedStart,
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
        indoor: f.indoor,
        surface: f.surface,
        nature: f.nature,
        trainingTypes: f.trainingTypes?.length ? f.trainingTypes : undefined,
        trainingFocus: f.trainingFocus?.trim() || undefined,
        sets: sets.filter((x) => Number.isFinite(x.a) || Number.isFinite(x.b)),
        technique: Object.values(technique).some((v) => v !== undefined && v !== null) ? technique : undefined,
        fitness: Object.values(fitness).some((v) => v !== undefined && v !== null) ? fitness : undefined,
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
            <div className="mb-1.5 text-xs font-medium text-ink-3">性质(可选)</div>
            <select
              value={f.nature ?? ''}
              onChange={(e) => setF((c) => ({ ...c, nature: (e.target.value || undefined) as ActivityInput['nature'] }))}
              className="h-11 w-full rounded-xl bg-surface-2 px-2 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
            >
              <option value="">不限</option>
              <option value="training">训练</option>
              <option value="official">正式比赛</option>
              <option value="friendly">友谊赛</option>
              <option value="practice">练习赛</option>
              <option value="serving">发球训练</option>
              <option value="multiball">多球训练</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">对手(可选)</div>
            <input
              value={f.partners}
              onChange={(e) => setF((c) => ({ ...c, partners: e.target.value }))}
              placeholder="如:vs 老张 / 和小李双打"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
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

        {/* 盘数比分明细 */}
        <Card className="space-y-3 !p-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold text-ink-2">每一盘比分</div>
            <button
              onClick={() => setSets((cur) => [...cur, { a: undefined as unknown as number, b: undefined as unknown as number }])}
              className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2 active:scale-95"
            >
              + 添加一盘
            </button>
          </div>
          {sets.length === 0 && (
            <p className="text-xs text-ink-3">可选。逐盘记比分(如 6-4),总盘数和胜负会自动算;不填也不影响只记胜负。</p>
          )}
          {sets.map((st, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="num w-12 shrink-0 text-xs text-ink-3">Set {idx + 1}</span>
              <input
                value={Number.isFinite(st.a) ? st.a : ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, '')
                  setSets((cur) => cur.map((x, i2) => (i2 === idx ? { ...x, a: v === '' ? (undefined as unknown as number) : parseInt(v, 10) } : x)))
                }}
                inputMode="numeric"
                placeholder="6"
                className="num h-10 min-w-0 flex-1 rounded-xl bg-surface-2 px-2 text-center text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              />
              <span className="text-ink-3">-</span>
              <input
                value={Number.isFinite(st.b) ? st.b : ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, '')
                  setSets((cur) => cur.map((x, i2) => (i2 === idx ? { ...x, b: v === '' ? (undefined as unknown as number) : parseInt(v, 10) } : x)))
                }}
                inputMode="numeric"
                placeholder="4"
                className="num h-10 min-w-0 flex-1 rounded-xl bg-surface-2 px-2 text-center text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
              />
              <button
                onClick={() => setSets((cur) => cur.filter((_, i2) => i2 !== idx))}
                className="rounded-lg p-1.5 text-ink-3 hover:text-danger"
                aria-label={`删除第 ${idx + 1} 盘`}
              >
                ✕
              </button>
            </div>
          ))}
        </Card>

        {/* 场地 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">场地</div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">室内 / 室外(可选)</div>
            <div className="flex rounded-xl bg-surface-2 p-1">
              {(
                [
                  { v: 'outdoor', label: '室外' },
                  { v: 'indoor', label: '室内' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setF((c) => ({ ...c, indoor: c.indoor === o.v ? undefined : o.v }))}
                  className={
                    'flex-1 rounded-lg py-2 text-sm font-medium transition-colors ' +
                    (f.indoor === o.v ? 'bg-accent text-accent-ink' : 'text-ink-3')
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">场地类型(可选)</div>
            <select
              value={f.surface ?? ''}
              onChange={(e) => setF((c) => ({ ...c, surface: (e.target.value || undefined) as ActivityInput['surface'] }))}
              className="h-11 w-full rounded-xl bg-surface-2 px-2 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
            >
              <option value="">不限</option>
              <option value="hard">硬地</option>
              <option value="clay">红土</option>
              <option value="grass">草地</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">场地名称(可选)</div>
            <input
              value={f.venue}
              onChange={(e) => setF((c) => ({ ...c, venue: e.target.value }))}
              placeholder="如:小区网球场"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
        </Card>

        {/* 技术统计(全部可选,手动填写) */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">技术统计</div>
          <p className="text-xs text-ink-3">全部可选,手动填写;留空即不计入统计。</p>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">发球</div>
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { key: 'firstServeIn', label: '一发成功' },
                  { key: 'firstServePoints', label: '一发得分' },
                  { key: 'doubleFaults', label: '双误' },
                  { key: 'aces', label: 'Ace' },
                  { key: 'serveGames', label: '发球局' },
                  { key: 'servePointsWon', label: '发球得分' },
                ] as const
              ).map((o) => (
                <div key={o.key}>
                  <div className="mb-1 text-center text-[10px] leading-tight text-ink-3">{o.label}</div>
                  <input
                    value={(technique[o.key] as number | undefined) ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, '')
                      setTechnique((c) => ({ ...c, [o.key]: v === '' ? undefined : parseInt(v, 10) }))
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    className="num h-10 w-full rounded-xl bg-surface-2 px-2 text-center text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">接发 / 网前</div>
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { key: 'returnPointsWon', label: '接发得分' },
                  { key: 'breakPoints', label: '破发点' },
                  { key: 'breakConverted', label: '破发成功' },
                  { key: 'netPointsWon', label: '网前得分' },
                ] as const
              ).map((o) => (
                <div key={o.key}>
                  <div className="mb-1 text-center text-[10px] leading-tight text-ink-3">{o.label}</div>
                  <input
                    value={(technique[o.key] as number | undefined) ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, '')
                      setTechnique((c) => ({ ...c, [o.key]: v === '' ? undefined : parseInt(v, 10) }))
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    className="num h-10 w-full rounded-xl bg-surface-2 px-2 text-center text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">击球</div>
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  { key: 'winners', label: 'Winners 制胜分' },
                  { key: 'unforcedErrors', label: '非受迫性失误' },
                ] as const
              ).map((o) => (
                <div key={o.key}>
                  <div className="mb-1 text-center text-[10px] leading-tight text-ink-3">{o.label}</div>
                  <input
                    value={(technique[o.key] as number | undefined) ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, '')
                      setTechnique((c) => ({ ...c, [o.key]: v === '' ? undefined : parseInt(v, 10) }))
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    className="num h-10 w-full rounded-xl bg-surface-2 px-2 text-center text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
                  />
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* 体能数据(全部可选) */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">体能数据</div>
          <p className="text-xs text-ink-3">可选;没有设备数据就留空,不会生成任何数字。</p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: 'runMinutes', label: '跑动时间(分钟)' },
                { key: 'runDistanceM', label: '跑动距离(米)' },
                { key: 'avgHr', label: '平均心率' },
                { key: 'maxHr', label: '最大心率' },
              ] as const
            ).map((o) => (
              <div key={o.key}>
                <div className="mb-1.5 text-xs font-medium text-ink-3">{o.label}</div>
                <input
                  value={(fitness[o.key] as number | undefined) ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, '')
                    setFitness((c) => ({ ...c, [o.key]: v === '' ? undefined : parseInt(v, 10) }))
                  }}
                  inputMode="numeric"
                  placeholder="0"
                  className="num h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line focus:ring-accent/50"
                />
              </div>
            ))}
          </div>
        </Card>

        {/* 训练模式 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">训练模式(可选)</div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">训练类型(可多选)</div>
            <div className="flex flex-wrap gap-1.5">
              {(['发球', '正手', '反手', '截击', '高压球', '接发', '底线', '多球', '移动', '综合训练'] as const).map((t) => {
                const sel = (f.trainingTypes ?? []).includes(t)
                return (
                  <button
                    key={t}
                    onClick={() =>
                      setF((c) => ({
                        ...c,
                        trainingTypes: sel
                          ? (c.trainingTypes ?? []).filter((x) => x !== t)
                          : [...(c.trainingTypes ?? []), t],
                      }))
                    }
                    className={
                      'rounded-full px-3 py-1.5 text-[13px] font-medium transition-all active:scale-95 ' +
                      (sel ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-3')
                    }
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">今天主要训练内容(可选)</div>
            <input
              value={f.trainingFocus}
              onChange={(e) => setF((c) => ({ ...c, trainingFocus: e.target.value }))}
              placeholder="如:发球 + 正手"
              className="h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
        </Card>

        {/* 其他 */}
        <Card className="space-y-3.5 !p-4">
          <div className="text-[13px] font-semibold text-ink-2">其他(全部可选)</div>
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
            <p className="mt-1.5 select-none text-right text-[11px] italic text-ink-3/70">今天有没有想三毛?</p>
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
  const statsData = useLiveQuery(async () => {
    return { stats: await getTennisStats(), trend: await getTennisMonthlyTrend(6) }
  }, [], undefined)
  const trend = statsData?.trend
  const stats = statsData?.stats

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
              <div className="num text-2xl font-bold">{stats ? String(stats.totalSessions) : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总场次</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{stats ? fmtHours(stats.totalMinutes) : '…'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">总时长{stats && stats.avgMinutes !== null ? ` · 均 ${stats.avgMinutes}分` : ""}</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">
                {stats && stats.setsWon + stats.setsLost > 0 ? `${stats.setsWon}:${stats.setsLost}` : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">盘数 胜:负</div>
            </div>
            <div>
              <div className="num text-2xl font-bold">{stats?.matchWinRate !== null && stats !== undefined ? `${stats.matchWinRate}%` : '—'}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">场胜率</div>
            </div>
          </div>
          {stats && stats.totalSessions > 0 && (
            <div className="num mt-4 flex justify-around rounded-2xl bg-surface-2 py-2.5 text-center text-xs text-ink-3">
              <span>比赛 {stats.matchCount} · 训练 {stats.trainingCount}</span>
              <span>本周 {stats.weekSessions} 次</span>
              <span>本月 {stats.monthSessions} 次</span>
            </div>
          )}
          {stats && stats.aces + stats.doubleFaults + stats.winners + stats.unforcedErrors > 0 && (
            <div className="num mt-3 grid grid-cols-4 gap-2 text-center">
              {(
                [
                  { label: 'Ace', value: stats.aces },
                  { label: '双误', value: stats.doubleFaults },
                  { label: '制胜分', value: stats.winners },
                  { label: '失误', value: stats.unforcedErrors },
                ] as const
              ).map((o) => (
                <div key={o.label} className="rounded-2xl bg-surface-2 py-2.5">
                  <div className="num text-lg font-bold">{o.value}</div>
                  <div className="mt-0.5 text-[10px] text-ink-3">{o.label}</div>
                </div>
              ))}
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
                        s.sets && s.sets.length > 0
                          ? `${s.sets.length} 盘 · 胜 ${s.sets.filter((x) => x.a > x.b).length} : 负 ${s.sets.filter((x) => x.b > x.a).length}`
                          : (s.score?.gamesTotal ?? 0) > 0
                            ? `${s.score?.gamesTotal} 盘 · 胜 ${s.score?.gamesWon} : 负 ${s.score?.gamesLost}`
                            : null,
                        s.sets?.length
                          ? s.sets.map((x) => `${Number.isFinite(x.a) ? x.a : '?'}-${Number.isFinite(x.b) ? x.b : '?'}`).join(' ')
                          : null,
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
