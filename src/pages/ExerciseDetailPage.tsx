import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { ChevronLeft, Trophy, Pencil, Trash2 } from 'lucide-react'
import { db } from '@/db/db'
import { BODY_PARTS, BODY_PART_META, type BodyPartId, type PREvent } from '@/db/models'
import { fmtDateCN, fmtDateFullCN, fmtMonthCN, fmtNum, fmtVolume, todayStr, addDays, cn } from '@/lib/util'
import { getExerciseTrend, getExerciseMonthStats } from '@/services/stats'
import { getPRs, getPREvents, getLastPerformance } from '@/services/pr'
import { toDisplayWeight } from '@/services/calc'
import { collapseSets, fmtSetGroup } from '@/lib/util'
import { Button, Card, SectionTitle, Segmented, Sheet } from '@/components/ui/basic'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'
import { TrendChart } from '@/components/charts/charts'
import { toast, useSettings } from '@/store/settings'
import { updateExercise, deleteExercise, createExercise } from '@/services/repo'

type Metric = 'weight' | 'est1rm' | 'reps' | 'volume'

/** 动作详情:当前最佳 + 力量趋势 + 月度比较 + PR 时间线 */
export default function ExerciseDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { unit } = useSettings()
  const [metric, setMetric] = useState<Metric>('est1rm')
  const [editOpen, setEditOpen] = useState(false)

  const exercise = useLiveQuery(() => db.exercises.get(id), [id], undefined)
  const prs = useLiveQuery(() => getPRs(id), [id], undefined)
  const trend = useLiveQuery(() => getExerciseTrend(id), [id], undefined)
  const events = useLiveQuery(() => getPREvents(id, 20), [id], undefined)
  const lastPerf = useLiveQuery(() => getLastPerformance(id), [id], undefined)

  const disp = useMemo(() => {
    const conv = (kg: number) => {
      const v = toDisplayWeight(kg, unit)
      return Number.isInteger(v) ? String(v) : v.toFixed(1)
    }
    return { conv, suffix: unit }
  }, [unit])

  if (exercise === undefined) return <div className="p-6 text-ink-3">加载中…</div>
  if (!exercise) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <p className="text-ink-3">动作不存在</p>
        <Button onClick={() => navigate(-1)}>返回</Button>
      </div>
    )
  }
  const meta = BODY_PART_META[exercise.bodyPart]

  const prMap = new Map((prs ?? []).map((p) => [p.type, p]))
  const best = prMap.get('est1rm') ?? prMap.get('maxWeight') ?? prMap.get('maxReps')

  // 图表数据(当前指标,显示单位换算)
  const chartData: { x: string; y: number }[] = (trend ?? [])
    .map((t) => {
      let y = 0
      if (metric === 'weight') y = t.weight
      else if (metric === 'est1rm') y = t.est1rm
      else if (metric === 'reps') y = t.reps
      else y = t.volume
      if (metric === 'weight' || metric === 'est1rm') y = toDisplayWeight(y, unit)
      return { x: fmtDateCN(t.date), y: Math.round(y * 10) / 10 }
    })
    .filter((p) => p.y > 0)

  return (
    <div className="min-h-dvh bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${meta?.color}22`, color: meta?.color }}>
                {meta?.name}
              </span>
              <h1 className="truncate text-[17px] font-semibold">{exercise.name}</h1>
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="编辑动作">
            <Pencil size={17} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 pt-4">
        {/* 当前最佳 */}
        <div className="grid grid-cols-3 gap-3">
          <BestTile
            label="最佳一组"
            value={best ? (best.weight > 0 ? `${disp.conv(best.weight)}${disp.suffix} × ${best.reps}` : `${best.reps} 次`) : '—'}
            delay={0}
          />
          <BestTile
            label="估算 1RM"
            value={prMap.has('est1rm') ? `${disp.conv(prMap.get('est1rm')!.value)}${disp.suffix}` : '—'}
            accent
            delay={0.05}
          />
          <BestTile
            label="最大重量"
            value={prMap.has('maxWeight') ? `${disp.conv(prMap.get('maxWeight')!.value)}${disp.suffix}` : '自重'}
            delay={0.1}
          />
        </div>

        {/* 上次成绩 */}
        {lastPerf && lastPerf.sets.length > 0 && (
          <Card delay={0.12}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-medium text-ink-2">
                上次 · {fmtDateFullCN(lastPerf.date)}
              </h3>
              <span className="num text-xs text-ink-3">{lastPerf.sets.length} 组</span>
            </div>
            <div className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[15px] font-semibold">
              {collapseSets(lastPerf.sets).map((c, i) => (
                <span key={i}>{fmtSetGroup(c)}</span>
              ))}
            </div>
          </Card>
        )}

        {/* 力量趋势 */}
        <Card delay={0.15} className={WM_PANEL}>
          <BrandWatermark size="sm" pos="tl" opacity="opacity-[0.025]" />
          <SectionTitle title="力量趋势" />
          <Segmented
            options={[
              { value: 'est1rm', label: '1RM' },
              { value: 'weight', label: '重量' },
              { value: 'reps', label: '次数' },
              { value: 'volume', label: '容量' },
            ]}
            value={metric}
            onChange={setMetric}
          />
          <div className="mt-3">
            <TrendChart
              data={chartData}
              height={210}
              valueFormatter={(v) =>
                metric === 'volume' ? `${fmtNum(v)}kg` : metric === 'reps' ? `${v}次` : `${v}${disp.suffix}`
              }
            />
          </div>
          {(trend?.length ?? 0) < 2 && (
            <p className="text-center text-xs text-ink-3">再记录一次训练即可看到趋势线</p>
          )}
        </Card>

        {/* 月度比较 */}
        <MonthCompare exerciseId={id} />

        {/* PR 时间线 */}
        <div>
          <SectionTitle title="PR 记录" />
          <div className="space-y-2">
            {(events ?? []).length === 0 && (
              <Card className="text-sm text-ink-3">还没有 PR 记录,完成一次训练后自动生成。</Card>
            )}
            {(events ?? []).slice(0, 10).map((e, i) => (
              <PREventRow key={e.id} event={e} unit={unit} delay={i * 0.03} />
            ))}
          </div>
        </div>
      </main>

      <ExerciseEditSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{ id: exercise.id, name: exercise.name, bodyPart: exercise.bodyPart }}
        onDeleted={() => navigate('/me')}
      />
    </div>
  )
}

function BestTile({ label, value, accent, delay }: { label: string; value: string; accent?: boolean; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className={cn(
        'rounded-3xl p-4 ring-1',
        accent ? 'bg-pr/[0.08] ring-pr/30' : 'bg-surface ring-line',
      )}
    >
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cn('num mt-1 text-[17px] font-bold leading-tight', accent && 'text-pr')}>{value}</div>
    </motion.div>
  )
}

/* =============== 月度比较 =============== */

function MonthCompare({ exerciseId }: { exerciseId: string }) {
  const thisMonth = todayStr().slice(0, 7)
  const prevMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7)
  const cur = useLiveQuery(() => getExerciseMonthStats(exerciseId, thisMonth), [exerciseId, thisMonth], undefined)
  const prev = useLiveQuery(() => getExerciseMonthStats(exerciseId, prevMonth), [exerciseId, prevMonth], undefined)
  const { unit } = useSettings()

  if (cur === undefined || prev === undefined) return <div className="skeleton h-28 rounded-3xl" />
  if (!cur || !prev || cur.bestEst1rm <= 0 || prev.bestEst1rm <= 0) {
    return (
      <Card delay={0.18}>
        <SectionTitle title="月度比较" />
        <p className="py-2 text-sm text-ink-3">数据不足,暂不判断。两个月都有记录后,这里会显示进步幅度。</p>
      </Card>
    )
  }
  const conv = (kg: number) => {
    const v = toDisplayWeight(kg, unit)
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }
  const weightDelta = Math.round((cur.bestEst1rmWeight - prev.bestEst1rmWeight) * 10) / 10
  const pct = Math.round(((cur.bestEst1rm - prev.bestEst1rm) / prev.bestEst1rm) * 1000) / 10

  return (
    <Card delay={0.18}>
      <SectionTitle title={`月度比较 · ${fmtMonthCN(thisMonth)} vs ${fmtMonthCN(prevMonth)}`} />
      <div className="flex items-center justify-around py-1 text-center">
        <div>
          <div className="text-[11px] text-ink-3">{fmtMonthCN(prevMonth)}</div>
          <div className="num mt-0.5 text-[15px] font-semibold">
            {conv(prev.bestEst1rmWeight)}kg × {prev.bestEst1rmReps}
          </div>
        </div>
        <div className="text-ink-3">→</div>
        <div>
          <div className="text-[11px] text-ink-3">{fmtMonthCN(thisMonth)}</div>
          <div className="num mt-0.5 text-[15px] font-semibold">
            {conv(cur.bestEst1rmWeight)}kg × {cur.bestEst1rmReps}
          </div>
        </div>
      </div>
      {weightDelta > 0 ? (
        <div className="num mt-2 text-center text-xl font-bold text-grow">
          +{toDisplayWeight(weightDelta, unit).toFixed(1)}{unit}
          <span className="ml-2 text-sm font-medium">估算力量提升 {pct}%</span>
        </div>
      ) : weightDelta < 0 ? (
        <div className="num mt-2 text-center text-xl font-bold text-warn">
          {toDisplayWeight(weightDelta, unit).toFixed(1)}{unit}
          <span className="ml-2 text-sm font-medium">比上月 {pct}%</span>
        </div>
      ) : (
        <p className="mt-2 text-center text-sm text-ink-3">与上月基本持平,继续积累。</p>
      )}
    </Card>
  )
}

/* =============== PR 事件行 =============== */

function PREventRow({ event, unit, delay }: { event: PREvent; unit: 'kg' | 'lb'; delay: number }) {
  const typeLabel: Record<string, string> = {
    est1rm: '估算 1RM',
    maxWeight: '最大重量',
    maxReps: '最大次数',
    volume: '单次容量',
  }
  const conv = (kg: number) => {
    const v = toDisplayWeight(kg, unit)
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }
  const valueText =
    event.type === 'maxReps'
      ? `${event.reps} 次`
      : event.type === 'volume'
        ? fmtVolume(event.value)
        : `${conv(event.weight)}${unit} × ${event.reps}`
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line"
    >
      <span className="flex size-8 items-center justify-center rounded-xl bg-pr/15">
        <Trophy size={15} className="text-pr" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{typeLabel[event.type]}</div>
        <div className="text-[11px] text-ink-3">{fmtDateFullCN(event.date)}</div>
      </div>
      <span className="num text-[15px] font-bold text-pr">{valueText}</span>
    </motion.div>
  )
}

/* =============== 编辑动作 =============== */

export function ExerciseEditSheet({
  open,
  onClose,
  initial,
  onDeleted,
}: {
  open: boolean
  onClose: () => void
  initial: { id?: string; name: string; bodyPart: BodyPartId }
  onDeleted?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [part, setPart] = useState<BodyPartId>(initial.bodyPart)
  const key = initial.id ?? 'new'
  // 打开时同步
  useMemo(() => {
    setName(initial.name)
    setPart(initial.bodyPart)
  }, [key, open])

  async function handleSave() {
    try {
      if (initial.id) {
        await updateExercise(initial.id, { name, bodyPart: part })
        toast('已保存')
      } else {
        await createExercise({ name, bodyPart: part })
        toast(`已添加「${name.trim()}」`)
      }
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败', 'error')
    }
  }

  async function handleDelete() {
    if (!initial.id) return
    if (!confirm(`删除「${initial.name}」?\n历史训练记录会保留并继续正确显示。`)) return
    await deleteExercise(initial.id)
    toast('已删除动作(历史记录保留)')
    onClose()
    onDeleted?.()
  }

  return (
    <Sheet open={open} onClose={onClose} title={initial.id ? '编辑动作' : '添加动作'}>
      <div className="space-y-4 pb-6">
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">动作名称</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如:高位下拉"
            className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-3">所属部位</div>
          <div className="grid grid-cols-3 gap-2">
            {BODY_PARTS.map((p) => {
              const meta = BODY_PART_META[p]
              const sel = part === p
              return (
                <button
                  key={p}
                  onClick={() => setPart(p)}
                  className={cn(
                    'h-11 rounded-2xl text-sm font-semibold transition-all active:scale-95',
                    sel ? 'text-accent-ink' : 'text-ink-2 ring-1 ring-line',
                  )}
                  style={sel ? { backgroundColor: meta.color } : { backgroundColor: 'var(--surface-2)' }}
                >
                  {meta.name}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex gap-2">
          {initial.id && (
            <Button variant="danger" onClick={handleDelete} className="shrink-0 px-4" aria-label="删除动作">
              <Trash2 size={16} />
            </Button>
          )}
          <Button block onClick={handleSave} disabled={!name.trim()}>
            保存
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          修改名称或部位后,所有历史训练记录会自动保持正确关联;删除为软删除,历史数据不受影响。
        </p>
      </div>
    </Sheet>
  )
}
