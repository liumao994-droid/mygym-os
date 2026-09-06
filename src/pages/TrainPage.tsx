import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { Copy, Play, Moon, Bookmark, Timer, ChevronRight } from 'lucide-react'
import { db } from '@/db/db'
import { BODY_PARTS, BODY_PART_META, SPORT_META, type BodyPartId } from '@/db/models'
import { addExerciseToSession, copyLastSession, markRest, startFromTemplate, startSession } from '@/services/repo'
import { collapseSets, cn, fmtDateCN, fmtWeight, haptic, todayStr } from '@/lib/util'
import { Button, Card, PageHeader, SectionTitle, Sheet } from '@/components/ui/basic'
import { ExercisePicker } from '@/components/ExercisePicker'
import { toast } from '@/store/settings'
import { BrandWatermark, WM_PANEL } from '@/components/BrandWatermark'
import type { Exercise } from '@/db/models'

/** 训练 Tab:开始训练 / 复制上次 / 模板 / 记录休息 */
export default function TrainPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<BodyPartId[]>([])
  const [restOpen, setRestOpen] = useState(false)
  const [quickPicker, setQuickPicker] = useState(false)

  const activeSession = useLiveQuery(async () => {
    const rows = await db.sessions.where('status').equals('active').toArray()
    return rows.sort((a, b) => b.startedAt - a.startedAt)[0]
  }, [])

  const lastSession = useLiveQuery(async () => {
    const rows = await db.sessions.where('status').equals('completed').toArray()
    const last = rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? -1 : 1))[0]
    if (!last) return null
    const [wes, sets, exs] = await Promise.all([
      db.workoutExercises.where('sessionId').equals(last.id).toArray(),
      db.sets.where('sessionId').equals(last.id).toArray(),
      db.exercises.toArray(),
    ])
    const exMap = new Map(exs.map((e) => [e.id, e]))
    const items = wes
      .sort((a, b) => a.order - b.order)
      .map((we) => {
        const ex = exMap.get(we.exerciseId)
        const mySets = sets.filter((s) => s.workoutExerciseId === we.id).sort((a, b) => a.setNumber - b.setNumber)
        return { name: ex?.name ?? '已删除动作', exId: we.exerciseId, collapsed: collapseSets(mySets) }
      })
      .filter((x) => x.name !== '已删除动作')
    return { session: last, items }
  }, [])

  const templates = useLiveQuery(() => db.templates.orderBy('updatedAt').reverse().toArray(), [], [])
  const exerciseCount = useLiveQuery(() => db.exercises.filter((e) => !e.deletedAt).count(), [], 0)

  const togglePart = (p: BodyPartId) => {
    haptic(5)
    setSelected((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
  }

  async function handleStart() {
    if (!selected.length) return
    const s = await startSession(selected)
    haptic(20)
    navigate(`/workout/${s.id}`)
  }

  async function handleCopy() {
    const res = await copyLastSession()
    if (!res) {
      toast('还没有可复制的训练记录', 'error')
      return
    }
    haptic(20)
    navigate(`/workout/${res.session.id}`)
  }

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <BrandWatermark size="page" pos="tl" />
      <PageHeader title="训练" subtitle={todayStr().replaceAll('-', '.')} />

      {/* 进行中训练 */}
      {activeSession && (
        <div className="px-4">
          <motion.button
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => navigate(`/workout/${activeSession.id}`)}
            className="w-full rounded-3xl bg-accent p-4 text-left text-accent-ink active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold opacity-80">
              <Timer size={14} className="animate-pulse" /> 训练进行中
            </div>
            <div className="mt-1 text-xl font-bold">{activeSession.title}</div>
            <div className="mt-0.5 text-sm font-medium opacity-80">点击继续 →</div>
          </motion.button>
        </div>
      )}

      {/* 选择部位开始 */}
      <div className="px-4 pt-4">
        <Card className={WM_PANEL + " !p-5"}>
          <BrandWatermark size="md" pos="br" opacity="opacity-[0.03]" />
          <h2 className="text-lg font-bold">今天练什么?</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">选择 1 个或多个部位</p>
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {BODY_PARTS.map((p) => {
              const meta = BODY_PART_META[p]
              const isSel = selected.includes(p)
              return (
                <button
                  key={p}
                  onClick={() => togglePart(p)}
                  className={cn(
                    'relative flex h-16 items-center justify-center rounded-2xl text-[15px] font-semibold transition-all active:scale-95',
                    isSel ? 'text-accent-ink' : 'text-ink-2 ring-1 ring-line',
                  )}
                  style={isSel ? { backgroundColor: meta.color } : { backgroundColor: 'var(--surface-2)' }}
                >
                  {meta.name}
                  {isSel && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#F5EFEA]/60" />}
                </button>
              )
            })}
          </div>
          <Button block size="lg" className="mt-4" disabled={!selected.length} onClick={handleStart}>
            <Play size={17} /> 开始训练{selected.length ? ` · ${selected.map((p) => BODY_PART_META[p].name).join(' + ')}` : ''}
          </Button>
          <button
            onClick={() => setQuickPicker(true)}
            className="mt-2 w-full py-2 text-[13px] text-ink-3 transition-colors hover:text-ink"
          >
            直接添加单个动作 →
          </button>
        </Card>
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        <QuickCard
          icon={<Copy size={18} />}
          title="复制上次训练"
          desc={lastSession ? `${lastSession.session.title} · ${fmtDateCN(lastSession.session.date)}` : '暂无记录'}
          onClick={handleCopy}
          delay={0.05}
        />
        <QuickCard
          icon={<Moon size={18} />}
          title="记录休息"
          desc="休息也是训练的一部分"
          onClick={() => setRestOpen(true)}
          delay={0.1}
        />
{(Object.keys(SPORT_META) as (keyof typeof SPORT_META)[])
          .filter((sp) => sp !== 'strength')
          .map((sp, i) => {
            const meta = SPORT_META[sp]
            return (
              <motion.button
                key={sp}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => navigate(`${meta.routeBase}/new`)}
                className="relative col-span-2 flex items-center gap-3 rounded-3xl bg-surface p-4 text-left ring-1 ring-line transition-transform active:scale-[0.99]"
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
                  className="flex size-10 items-center justify-center rounded-xl text-lg"
                  style={{ backgroundColor: `${meta.color}22` }}
                >
                  {meta.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{meta.name}</span>
                  <span className="block text-xs text-ink-3">{meta.desc}</span>
                </span>
                <span className="text-ink-3">›</span>
              </motion.button>
            )
          })}
      </div>

      {/* 模板 */}
      <div className="px-4 pt-5">
        <SectionTitle title="训练模板" />
        <div className="space-y-2">
          {(templates ?? []).length === 0 && (
            <Card className="text-sm text-ink-3">
              还没有模板。完成一次训练后可以「保存为模板」,或到模板页创建。
            </Card>
          )}
          {(templates ?? []).map((t) => (
            <button
              key={t.id}
              onClick={async () => {
                const s = await startFromTemplateSafe(t.id)
                if (s) navigate(`/workout/${s}`)
              }}
              className="flex w-full items-center gap-3 rounded-3xl bg-surface p-4 text-left ring-1 ring-line active:scale-[0.99]"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent-dim text-accent">
                <Bookmark size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.name}</span>
                <span className="num block truncate text-xs text-ink-3">
                  {t.items.length} 个动作 ·{' '}
                  {t.items
                    .map((i) => {
                      const first = i.sets[0]
                      return first && first.weightType !== 'bodyweight' ? `${fmtWeight(Math.abs(first.weight))}kg` : null
                    })
                    .filter(Boolean)
                    .join(' / ')}
                </span>
              </span>
              <ChevronRight size={16} className="text-ink-3" />
            </button>
          ))}
        </div>
      </div>

      {/* 休息确认 */}
      <Sheet open={restOpen} onClose={() => setRestOpen(false)} title="记录休息日">
        <div className="pb-6 pt-2 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-3xl bg-rest/15 text-2xl">🌙</div>
          <p className="text-[15px] font-medium">今天休息</p>
          <p className="mx-auto mt-1 max-w-64 text-[13px] leading-relaxed text-ink-3">
            休息不是失败,而是训练计划的一部分。恢复日会被日历单独标记,不会打断你的连续性。
          </p>
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" block onClick={() => setRestOpen(false)}>
              取消
            </Button>
            <Button
              block
              onClick={async () => {
                await markRest(todayStr())
                haptic(15)
                setRestOpen(false)
                toast('已记录今天休息 🌙')
              }}
            >
              记录休息
            </Button>
          </div>
        </div>
      </Sheet>

      {/* 单动作快速开始 */}
      <QuickStartPicker
        open={quickPicker}
        onClose={() => setQuickPicker(false)}
        onPicked={(sessionId) => navigate(`/workout/${sessionId}`)}
        exerciseCount={exerciseCount ?? 0}
      />
    </div>
  )
}

async function startFromTemplateSafe(tplId: string): Promise<string | null> {
  const s = await startFromTemplate(tplId)
  return s?.id ?? null
}

function QuickCard({
  icon,
  title,
  desc,
  onClick,
  delay,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
  delay: number
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className="rounded-3xl bg-surface p-4 text-left ring-1 ring-line active:scale-[0.98]"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-dim text-accent">{icon}</span>
      <div className="mt-2.5 text-[15px] font-semibold">{title}</div>
      <div className="mt-0.5 truncate text-xs text-ink-3">{desc}</div>
    </motion.button>
  )
}

/** 单动作快速开始:选一个动作 → 自动建一个只含它的训练 */
function QuickStartPicker({
  open,
  onClose,
  onPicked,
  exerciseCount,
}: {
  open: boolean
  onClose: () => void
  onPicked: (sessionId: string) => void
  exerciseCount: number
}) {
  const [picked, setPicked] = useState<Exercise | null>(null)
  return (
    <>
      <ExercisePicker
        open={open}
        onClose={onClose}
        onPick={(ex) => {
          setPicked(ex)
          onClose()
        }}
        title="选择一个动作开始"
      />
      <Sheet open={!!picked} onClose={() => setPicked(null)} title={picked ? `开始:${picked.name}` : ''}>
        <div className="pb-6 pt-2 text-center">
          <p className="text-[13px] leading-relaxed text-ink-3">
            将创建一个单独训练{picked ? BODY_PART_META[picked.bodyPart].name : ''}部的会话,
            <br />
            上次成绩会自动显示,直接输入今天的数据即可。
          </p>
          <Button
            block
            size="lg"
            className="mt-4"
            onClick={async () => {
              if (!picked) return
              const s = await startSession([picked.bodyPart])
              await addExerciseToSession(s.id, picked.id)
              setPicked(null)
              onPicked(s.id)
            }}
          >
            开始({exerciseCount > 0 ? `${exerciseCount} 个动作可用` : '动作库为空'})
          </Button>
        </div>
      </Sheet>
    </>
  )
}
