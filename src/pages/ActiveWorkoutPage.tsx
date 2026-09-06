import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Plus, Minus, Trash2, MoreHorizontal, BookmarkPlus, Trophy } from 'lucide-react'
import { db } from '@/db/db'
import { BODY_PART_META, FEEL_LABEL, type WorkoutSet } from '@/db/models'
import {
  addExerciseToSession,
  addSet,
  completeSession,
  deleteSet,
  discardSession,
  getSessionDetail,
  removeExerciseFromSession,
  saveSessionAsTemplate,
  updateSet,
} from '@/services/repo'
import { estimate1RM, setVolume, fromDisplayWeight, toDisplayWeight } from '@/services/calc'
import { getLastPerformance } from '@/services/pr'
import { collapseSets, cn, fmtDateCN, fmtDuration, fmtSetGroup, fmtWeight, haptic } from '@/lib/util'
import { Button, Card, Sheet } from '@/components/ui/basic'
import { ExercisePicker } from '@/components/ExercisePicker'
import { FEEL_OPTIONS } from '@/db/defaults'
import { toast, useSettings } from '@/store/settings'

/**
 * 训练进行中 / 修改历史训练 —— 复用同一编辑器。
 * 输入体验优先:自动带上次成绩、大按钮步进、批量加组,尽量不碰键盘。
 */
export default function ActiveWorkoutPage({ viewOnly = false }: { viewOnly?: boolean }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { unit } = useSettings()

  const detail = useLiveQuery(() => getSessionDetail(id), [id], undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [celebration, setCelebration] = useState<{ name: string; text: string }[] | null>(null)
  const [elapsed, setElapsed] = useState('')

  const session = detail?.session

  // 计时器
  useEffect(() => {
    if (!session) return
    const start = session.startedAt
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - start) / 1000))
      const m = Math.floor(sec / 60)
      const s = sec % 60
      setElapsed(`${String(Math.floor(m / 60)).padStart(2, '0') === '00' ? '' : Math.floor(m / 60) + ':'}${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    if (viewOnly || session.status === 'completed') return
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [session, viewOnly])

  if (detail === undefined) {
    return <div className="p-6 text-ink-3">加载中…</div>
  }
  if (!session) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <p className="text-ink-3">训练不存在或已被删除</p>
        <Button onClick={() => navigate(-1)}>返回</Button>
      </div>
    )
  }

  const readOnly = viewOnly || session.status === 'completed'
  const totalSets = detail.exercises.reduce((acc, e) => acc + e.sets.length, 0)
  const totalVolume = Math.round(
    detail.exercises.reduce((acc, e) => acc + e.sets.reduce((a, s) => a + setVolume(s), 0), 0),
  )

  async function handlePick(exercise: { id: string }) {
    await addExerciseToSession(session!.id, exercise.id)
    setPickerOpen(false)
    haptic()
  }

  async function handleComplete(notes: string, feel: number | undefined) {
    const detail = await getSessionDetail(session!.id)
    const setCount = detail?.exercises.reduce((acc, e) => acc + e.sets.length, 0) ?? 0
    if (setCount === 0) {
      toast('还没有任何组数据:先完成至少一组,或放弃本次训练', 'error')
      return
    }
    const result = await completeSession(session!.id, {
      notes: notes || undefined,
      feel: feel as never,
      durationSec: Math.floor((Date.now() - session!.startedAt) / 1000),
    })
    haptic(30)
    if (result.newPRs.length) {
      setCelebration(
        result.newPRs.map((pr) => {
          const dispW = pr.weight > 0 ? fmtWeight(Math.round(toDisplayWeight(pr.weight, unit) * 100) / 100) : null
          const suffix = unit === 'kg' ? 'kg' : 'lb'
          return {
            name: pr.exerciseName,
            text: dispW ? `${dispW}${suffix} × ${pr.reps}` : `${pr.reps} 次`,
          }
        }),
      )
    } else {
      navigate('/history', { replace: true })
    }
  }

  return (
    <div className="min-h-dvh bg-bg pb-32">
      {/* 顶栏 */}
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => navigate(-1)}
            className="rounded-full p-2 text-ink-2 transition-colors hover:bg-surface-2"
            aria-label="返回"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{session.title}</div>
            <div className="num text-xs text-ink-3">
              {fmtDateCN(session.date)}
              {session.status === 'active' && !viewOnly ? ` · ${elapsed}` : ''}
              {' · '}
              {detail.exercises.length} 动作 {totalSets} 组
              {totalVolume > 0 ? ` · ${totalVolume.toLocaleString()}kg` : ''}
            </div>
          </div>
          {!readOnly && (
            <>
              <button
                onClick={() => setMenuOpen(true)}
                className="rounded-full p-2 text-ink-2 hover:bg-surface-2"
                aria-label="更多"
              >
                <MoreHorizontal size={20} />
              </button>
              <Button size="sm" onClick={() => setFinishOpen(true)} className="shrink-0">
                完成
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        {detail.exercises.length === 0 && (
          <Card className="py-10 text-center">
            <p className="text-ink-2">从右侧按钮添加第一个动作</p>
          </Card>
        )}
        {detail.exercises.map((item, idx) => (
          <ExerciseEditor
            key={item.id}
            weId={item.id}
            exerciseId={item.exercise.id}
            name={item.exercise.name}
            bodyPart={item.exercise.bodyPart}
            weightType={item.exercise.defaultWeightType}
            sets={item.sets}
            sessionId={session.id}
            readOnly={readOnly}
            unit={unit}
            delay={idx * 0.04}
          />
        ))}

        {!readOnly && (
          <Button variant="secondary" block size="lg" onClick={() => setPickerOpen(true)} className="mt-2">
            <Plus size={18} /> 添加动作
          </Button>
        )}

        {/* 感受/备注(保存过的会话展示) */}
        {(session.feel || session.notes) && (
          <Card delay={0.1}>
            <div className="flex flex-wrap items-center gap-2">
              {session.feel && (
                <span className="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium text-ink-2">
                  感受 · {FEEL_LABEL[session.feel]}
                </span>
              )}
              {session.durationSec ? (
                <span className="num rounded-full bg-surface-2 px-3 py-1 text-[13px] text-ink-3">
                  {fmtDuration(session.durationSec)}
                </span>
              ) : null}
            </div>
            {session.notes && (
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{session.notes}</p>
            )}
          </Card>
        )}
      </main>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={handlePick} />

      {/* 完成确认 */}
      <FinishSheet
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        onConfirm={handleComplete}
        setCount={totalSets}
      />

      {/* 更多菜单 */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="训练选项">
        <div className="space-y-2 pb-4">
          <Button
            variant="secondary"
            block
            onClick={async () => {
              try {
                await saveSessionAsTemplate(session.id, session.title || '我的模板')
                toast('已保存为模板')
                setMenuOpen(false)
              } catch (e) {
                toast(e instanceof Error ? e.message : '保存失败', 'error')
              }
            }}
          >
            <BookmarkPlus size={16} /> 保存为训练模板
          </Button>
          <Button
            variant="danger"
            block
            onClick={async () => {
              if (confirm('放弃本次训练?已输入的组数据会一并删除。')) {
                await discardSession(session.id)
                navigate('/', { replace: true })
              }
            }}
          >
            <Trash2 size={16} /> 放弃本次训练
          </Button>
        </div>
      </Sheet>

      {/* PR 庆祝 */}
      <AnimatePresence>
        {celebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[#081331]/70 p-6 backdrop-blur"
            onClick={() => {
              setCelebration(null)
              navigate('/history', { replace: true })
            }}
          >
            <motion.div
              initial={{ scale: 0.8, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', damping: 18, stiffness: 300 }}
              className="w-full max-w-sm rounded-3xl bg-bg-elev p-6 text-center ring-1 ring-line"
            >
              <motion.div
                animate={{ rotate: [0, -12, 12, 0], scale: [1, 1.2, 1] }}
                transition={{ duration: 0.9, delay: 0.2 }}
                className="mx-auto mb-3 flex size-16 items-center justify-center rounded-3xl bg-pr/15"
              >
                <Trophy size={32} className="text-pr" />
              </motion.div>
              <h2 className="text-xl font-bold">训练完成,新纪录!</h2>
              <div className="mt-4 space-y-2">
                {celebration.map((c, i) => (
                  <motion.div
                    key={c.name + i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.35 + i * 0.12 }}
                    className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="num font-semibold text-pr">{c.text}</span>
                  </motion.div>
                ))}
              </div>
              <Button block className="mt-5" onClick={() => {
                setCelebration(null)
                navigate('/history', { replace: true })
              }}>
                太棒了
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* =============== 单个动作编辑器 =============== */

function ExerciseEditor({
  weId,
  exerciseId,
  name,
  bodyPart,
  weightType,
  sets,
  sessionId,
  readOnly,
  unit,
  delay,
}: {
  weId: string
  exerciseId: string
  name: string
  bodyPart: string
  weightType: 'weight' | 'dumbbell' | 'bodyweight' | 'assisted'
  sets: WorkoutSet[]
  sessionId: string
  readOnly: boolean
  unit: 'kg' | 'lb'
  delay: number
}) {
  const meta = BODY_PART_META[bodyPart as keyof typeof BODY_PART_META]
  const lastPerf = useLiveQuery(() => getLastPerformance(exerciseId, sessionId), [exerciseId, sessionId])
  const best = useLiveQuery(
    () => db.personalRecords.where('exerciseId').equals(exerciseId).toArray(),
    [exerciseId],
  )

  const prMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of best ?? []) m.set(p.type, p.value)
    return m
  }, [best])

  // 输入状态(显示单位)
  const [wInput, setWInput] = useState<string>('')
  const [rInput, setRInput] = useState<string>('')
  const [nInput, setNInput] = useState<string>('1')
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current || readOnly) return
    if (lastPerf !== undefined) {
      initialized.current = true
      if (lastPerf) {
        const f = lastPerf.sets[0]
        if (f) {
          if (weightType !== 'bodyweight') setWInput(String(toDisplayWeight(Math.abs(f.weight), unit)))
          setRInput(String(f.reps))
          const collapsed = collapseSets(lastPerf.sets)
          setNInput(String(collapsed.length ? collapsed.reduce((a, c) => a + c.count, 0) / collapsed.length : 1))
        }
      } else if (weightType !== 'bodyweight') {
        setWInput(unit === 'kg' ? '20' : '45')
        setRInput('10')
      } else {
        setRInput('10')
      }
    }
  }, [lastPerf, weightType, unit, readOnly])

  const dispW = wInput === '' ? null : parseFloat(wInput)
  const dispR = rInput === '' ? null : parseInt(rInput, 10)
  const dispN = Math.max(1, parseInt(nInput, 10) || 1)
  const canAdd =
    dispR !== null &&
    Number.isFinite(dispR) &&
    dispR > 0 &&
    (weightType === 'bodyweight' || (dispW !== null && Number.isFinite(dispW) && dispW > 0))

  async function handleAdd() {
    if (!canAdd || dispW === null && weightType !== 'bodyweight') return
    const kg = weightType === 'bodyweight' ? 0 : fromDisplayWeight(weightType === 'assisted' ? -Math.abs(dispW ?? 0) : dispW ?? 0, unit)
    haptic()
    try {
      for (let i = 0; i < dispN; i++) {
        await addSet(weId, { weight: kg, reps: dispR ?? 0, weightType })
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '添加失败', 'error')
    }
  }

  const lastCollapsed = lastPerf ? collapseSets(lastPerf.sets) : []
  const isPRSet = (s: WorkoutSet): boolean => {
    if (s.weightType === 'weight' || s.weightType === 'dumbbell') {
      const est = estimate1RM(s.weight, s.reps)
      const pr1rm = prMap.get('est1rm')
      const prW = prMap.get('maxWeight')
      if (est !== null && pr1rm !== undefined && est > pr1rm) return true
      if (prW !== undefined && s.weight > prW) return true
      return false
    }
    const prR = prMap.get('maxReps')
    return prR !== undefined && s.reps > prR
  }

  return (
    <Card delay={delay} className="overflow-visible">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: `${meta?.color}22`, color: meta?.color }}
            >
              {meta?.name}
            </span>
            <h3 className="truncate text-[17px] font-semibold">{name}</h3>
          </div>
          {/* 上次 / 最佳 提示 */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
            {lastPerf && lastCollapsed.length > 0 && (
              <span className="num">
                上次 {fmtDateCN(lastPerf.date)}:{lastCollapsed.slice(0, 3).map((c) => fmtSetGroup(c)).join(' , ')}
                {lastCollapsed.length > 3 ? ' …' : ''}
              </span>
            )}
            {prMap.has('est1rm') && (
              <span className="num text-pr/90">
                估算1RM {fmtWeight(toDisplayWeight(prMap.get('est1rm')!, unit))}
                {unit}
              </span>
            )}
            {!prMap.has('est1rm') && prMap.has('maxReps') && (
              <span className="num">最佳 {prMap.get('maxReps')}次</span>
            )}
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={() => {
              if (confirm(`移除「${name}」${sets.length > 0 ? `及其 ${sets.length} 组数据` : ''}?`)) removeExerciseFromSession(weId)
            }}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-danger"
            aria-label="移除动作"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* 组列表 */}
      <div className="mt-3 space-y-1.5">
        {sets.length === 0 && <p className="py-1 text-xs text-ink-3">还没有组数据,在下方输入后点击「完成组」</p>}
        {sets.map((s) => (
          <SetRow
            key={s.id}
            set={s}
            unit={unit}
            readOnly={readOnly}
            isPR={isPRSet(s)}
            onChange={(patch) => updateSet(s.id, patch)}
            onDelete={() => {
              haptic(12)
              deleteSet(s.id)
            }}
          />
        ))}
      </div>

      {/* 输入条 */}
      {!readOnly && (
        <div className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-2.5">
          <div className="flex items-stretch gap-2">
            {weightType !== 'bodyweight' ? (
              <NumField
                label={weightType === 'assisted' ? '辅助kg' : unit === 'kg' ? (weightType === 'dumbbell' ? 'kg/只' : 'kg') : 'lb'}
                value={wInput}
                onChange={setWInput}
                step={2.5}
                wide
                prefix={weightType === 'assisted' ? '-' : undefined}
              />
            ) : (
              <div className="flex min-w-[84px] flex-1 flex-col items-center justify-center rounded-xl bg-surface px-3 py-1.5">
                <span className="text-[10px] leading-none text-ink-3">自重</span>
                <span className="mt-0.5 text-[17px] font-semibold">BW</span>
              </div>
            )}
            <NumField label="次数" value={rInput} onChange={setRInput} step={1} integer />
            <NumField label="组数" value={nInput} onChange={setNInput} step={1} integer min={1} />
          </div>
          <Button size="md" block disabled={!canAdd} onClick={handleAdd} className="h-11 rounded-xl">
            完成{dispN > 1 ? ` ${dispN} 组` : '这一组'}
          </Button>
        </div>
      )}
    </Card>
  )
}

/* =============== 组行 =============== */

function SetRow({
  set,
  unit,
  readOnly,
  isPR,
  onChange,
  onDelete,
}: {
  set: WorkoutSet
  unit: 'kg' | 'lb'
  readOnly: boolean
  isPR: boolean
  onChange: (patch: { weight?: number; reps?: number; rpe?: number }) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const dispWeight = weightTypeDisplay(set, unit)
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-2.5 py-2 text-[15px]',
        isPR ? 'bg-pr/10 ring-1 ring-pr/40' : 'bg-surface-2/60',
      )}
    >
      <span className="num w-7 shrink-0 text-xs text-ink-3">{set.setNumber}</span>
      {readOnly || !open ? (
        <>
          <span className="num flex-1 font-medium">
            {isPR && <Trophy size={13} className="mr-1 inline text-pr" />}
            {dispWeight}
          </span>
          <span className="num flex-1 text-ink-2">{set.reps} 次</span>
          {set.rpe !== undefined && <span className="num text-xs text-ink-3">RPE {set.rpe}</span>}
          {!readOnly && (
            <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-1 text-xs text-ink-3 hover:text-ink">
              编辑
            </button>
          )}
        </>
      ) : (
        <>
          <input
            type="number"
            inputMode="decimal"
            defaultValue={toDisplayWeight(Math.abs(set.weight), unit)}
            onBlur={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v >= 0) {
                const kg = fromDisplayWeight(v, unit)
                onChange({ weight: set.weightType === 'assisted' ? -kg : kg })
              }
            }}
            className="num h-9 w-20 rounded-lg bg-surface px-2 text-center outline-none ring-1 ring-line-strong"
          />
          <input
            type="number"
            inputMode="numeric"
            defaultValue={set.reps}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10)
              if (Number.isFinite(v) && v > 0) onChange({ reps: v })
            }}
            className="num h-9 w-16 rounded-lg bg-surface px-2 text-center outline-none ring-1 ring-line-strong"
          />
          <select
            defaultValue={set.rpe ?? ''}
            onChange={(e) => onChange({ rpe: e.target.value === '' ? undefined : Number(e.target.value) })}
            className="h-9 w-16 rounded-lg bg-surface px-1 text-xs outline-none ring-1 ring-line-strong"
          >
            <option value="">RPE</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-xs font-medium text-accent">
            完成
          </button>
          <button onClick={onDelete} className="rounded-lg p-1 text-ink-3 hover:text-danger" aria-label="删除该组">
            <Trash2 size={15} />
          </button>
        </>
      )}
    </div>
  )
}

function weightTypeDisplay(set: WorkoutSet, unit: 'kg' | 'lb'): string {
  if (set.weightType === 'bodyweight') return '自重'
  const w = fmtWeight(Math.round(toDisplayWeight(Math.abs(set.weight), unit) * 100) / 100)
  const suffix = unit === 'kg' ? 'kg' : 'lb'
  if (set.weightType === 'assisted') return `-${w}${suffix}`
  if (set.weightType === 'dumbbell') return `${w}${suffix}/只`
  return `${w}${suffix}`
}

/* =============== 数字输入字段(带步进) =============== */

function NumField({
  label,
  value,
  onChange,
  step,
  integer,
  min,
  prefix,
  wide,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step: number
  integer?: boolean
  min?: number
  prefix?: string
  wide?: boolean
}) {
  const bump = (dir: 1 | -1) => {
    const cur = parseFloat(value) || 0
    let next = cur + dir * step
    if (min !== undefined) next = Math.max(min, next)
    if (integer) next = Math.round(next)
    next = Math.round(next * 100) / 100
    onChange(String(next))
    haptic(5)
  }
  return (
    <div className={`flex min-w-0 flex-col rounded-xl bg-surface px-1.5 pb-1 pt-1 ${wide ? 'flex-[1.4]' : 'flex-1'}`}>
      <span className="text-center text-[10px] leading-none text-ink-3">{label}</span>
      <div className="mt-0.5 flex items-center">
        <button onClick={() => bump(-1)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 active:scale-90" aria-label={`减少${label}`}>
          <Minus size={13} />
        </button>
        <div className="relative min-w-0 flex-1">
          {prefix && <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[15px] font-semibold">{prefix}</span>}
          <input
            value={value}
            onChange={(e) => onChange(integer ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            className="num w-full bg-transparent text-center text-[17px] font-semibold outline-none"
          />
        </div>
        <button onClick={() => bump(1)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 active:scale-90" aria-label={`增加${label}`}>
          <Plus size={13} />
        </button>
      </div>
    </div>
  )
}

/* =============== 完成确认 Sheet =============== */

function FinishSheet({
  open,
  onClose,
  onConfirm,
  setCount,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (notes: string, feel: number | undefined) => void
  setCount: number
}) {
  const [notes, setNotes] = useState('')
  const [feel, setFeel] = useState<number | undefined>(undefined)
  return (
    <Sheet open={open} onClose={onClose} title="完成训练">
      <div className="space-y-4 pb-4">
        <p className="text-sm text-ink-2">
          本次共 <span className="num font-semibold text-ink">{setCount}</span> 组。系统会自动计算训练量并检查新的 PR。
        </p>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">训练感受(可选)</div>
          <div className="flex flex-wrap gap-1.5">
            {FEEL_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setFeel(feel === o.value ? undefined : o.value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[13px] transition-all active:scale-95',
                  feel === o.value ? 'bg-accent font-semibold text-accent-ink' : 'bg-surface-2 text-ink-2',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">备注(可选)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="今天状态不错 / 睡眠不好…"
            rows={2}
            className="w-full resize-none rounded-2xl bg-surface-2 p-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
          />
        </div>
        <Button
          block
          size="lg"
          onClick={() => {
            onConfirm(notes, feel)
            onClose()
          }}
        >
          保存并完成训练
        </Button>
      </div>
    </Sheet>
  )
}
