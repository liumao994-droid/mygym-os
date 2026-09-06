import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2, Play, Bookmark } from 'lucide-react'
import { db } from '@/db/db'
import { BODY_PART_META, type BodyPartId, type WorkoutTemplate } from '@/db/models'
import { fmtWeight } from '@/lib/util'
import { deleteTemplate, saveTemplate, startFromTemplate } from '@/services/repo'
import { Button, Card, Chip, SectionTitle } from '@/components/ui/basic'
import { ExercisePicker } from '@/components/ExercisePicker'
import { toast } from '@/store/settings'
import { BrandWatermark } from '@/components/BrandWatermark'

interface DraftItem {
  exerciseId: string
  exerciseName: string
  weight: string
  reps: string
  count: string
  weightType: 'weight' | 'dumbbell' | 'bodyweight' | 'assisted'
}

/** 模板管理:保存固定训练结构,一键开始 */
export default function TemplatesPage() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.orderBy('updatedAt').reverse().toArray(), [], undefined)
  const [editor, setEditor] = useState<{ open: boolean; tpl?: WorkoutTemplate }>({ open: false })

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-[var(--nav-blur)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2.5">
          <button onClick={() => navigate('/me')} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="返回">
            ←
          </button>
          <h1 className="flex-1 text-[17px] font-semibold">训练模板</h1>
          <button
            onClick={() => setEditor({ open: true })}
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink active:scale-95"
            aria-label="新建模板"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <BrandWatermark size="page" pos="tl" />
      <main className="mx-auto max-w-2xl space-y-2.5 px-4 pt-4">
        {templates === undefined && <div className="skeleton h-40 rounded-3xl" />}
        {templates !== undefined && templates.length === 0 && (
          <Card className="!p-8 text-center">
            <div className="mb-2 flex justify-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-dim text-accent">
                <Bookmark size={22} />
              </span>
            </div>
            <p className="font-semibold">还没有模板</p>
            <p className="mx-auto mt-1 max-w-64 text-sm leading-relaxed text-ink-3">
              模板是长期固定的训练结构(如「背 + 二头 A」)。新建一个,或完成训练后在训练页「保存为模板」。
            </p>
            <Button className="mt-5" onClick={() => setEditor({ open: true })}>
              <Plus size={16} /> 新建模板
            </Button>
          </Card>
        )}

        {templates?.map((tpl) => (
          <Card key={tpl.id} className="!p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-semibold">{tpl.name}</div>
                <div className="num mt-0.5 text-xs text-ink-3">
                  {tpl.items.length} 个动作 · {tpl.items.reduce((a, i) => a + i.sets.reduce((b, s) => b + s.count, 0), 0)} 组
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={async () => {
                    const s = await startFromTemplate(tpl.id)
                    if (s) navigate(`/workout/${s.id}`)
                  }}
                >
                  <Play size={14} /> 开始
                </Button>
                <button
                  onClick={() => setEditor({ open: true, tpl })}
                  className="rounded-xl bg-surface-2 px-3 text-sm text-ink-2 active:scale-95"
                >
                  编辑
                </button>
                <button
                  onClick={async () => {
                    if (confirm(`删除模板「${tpl.name}」?`)) {
                      await deleteTemplate(tpl.id)
                      toast('模板已删除')
                    }
                  }}
                  className="rounded-xl bg-surface-2 px-2.5 text-ink-3 hover:text-danger active:scale-95"
                  aria-label="删除模板"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="mt-2.5 space-y-1 border-t border-line pt-2.5">
              {tpl.items.map((item) => {
                const first = item.sets[0]
                return (
                  <div key={item.exerciseId} className="num flex items-baseline justify-between text-[13px]">
                    <TemplateName exerciseId={item.exerciseId} />
                    <span className="text-ink-3">
                      {first
                        ? first.weightType === 'bodyweight'
                          ? `自重 × ${first.reps} × ${first.count}`
                          : `${fmtWeight(Math.abs(first.weight))}kg × ${first.reps} × ${first.count}`
                        : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </main>

      {editor.open && (
        <TemplateEditor
          tpl={editor.tpl}
          onClose={() => setEditor({ open: false })}
        />
      )}
    </div>
  )
}

function TemplateName({ exerciseId }: { exerciseId: string }) {
  const name = useLiveQuery(() => db.exercises.get(exerciseId), [exerciseId], undefined)
  return <span className="text-ink-2">{name === undefined ? '…' : (name?.name ?? '已删除动作')}</span>
}

/* =============== 模板编辑器 =============== */

function TemplateEditor({ tpl, onClose }: { tpl?: WorkoutTemplate; onClose: () => void }) {
  const [name, setName] = useState(tpl?.name ?? '')
  const [parts, setParts] = useState<BodyPartId[]>(tpl?.bodyParts ?? [])
  const [items, setItems] = useState<DraftItem[]>(
    tpl?.items.map((i) => {
      const s = i.sets[0]
      return {
        exerciseId: i.exerciseId,
        exerciseName: '',
        weight: s ? String(Math.abs(s.weight)) : '20',
        reps: s ? String(s.reps) : '10',
        count: s ? String(s.count) : '1',
        weightType: s?.weightType ?? 'weight',
      }
    }) ?? [],
  )
  const [pickerOpen, setPickerOpen] = useState(false)

  function pick(exercise: { id: string; name: string; defaultWeightType: 'weight' | 'dumbbell' | 'bodyweight' | 'assisted' }) {
    setItems((cur) => [
      ...cur.filter((x) => x.exerciseId !== exercise.id),
      {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        weight: '20',
        reps: '10',
        count: '3',
        weightType: exercise.defaultWeightType,
      },
    ])
    setPickerOpen(false)
  }

  async function handleSave() {
    try {
      await saveTemplate({
        id: tpl?.id,
        name,
        bodyParts: parts.length ? parts : ['chest'],
        items: items.map((i) => ({
          exerciseId: i.exerciseId,
          sets: [
            {
              weight: i.weightType === 'assisted' ? -Math.abs(parseFloat(i.weight) || 0) : parseFloat(i.weight) || 0,
              reps: parseInt(i.reps, 10) || 0,
              count: Math.max(1, parseInt(i.count, 10) || 1),
              weightType: i.weightType,
            },
          ],
        })),
      })
      toast(tpl ? '模板已更新' : '模板已创建')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
        <div className="safe-top sticky top-0 z-10 border-b border-line bg-[var(--nav-blur)] px-3 py-2.5 backdrop-blur-xl">
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <button onClick={onClose} className="rounded-full p-2 text-ink-2" aria-label="关闭">
              ←
            </button>
            <h1 className="flex-1 text-[17px] font-semibold">{tpl ? '编辑模板' : '新建模板'}</h1>
            <Button size="sm" onClick={handleSave} disabled={!name.trim() || items.length === 0}>
              保存
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-28">
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">模板名称</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如:背 + 二头 A"
              className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[15px] outline-none ring-1 ring-line placeholder:text-ink-3 focus:ring-accent/50"
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">主要部位</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(BODY_PART_META) as BodyPartId[]).map((p) => (
                <Chip
                  key={p}
                  selected={parts.includes(p)}
                  color={BODY_PART_META[p].color}
                  onClick={() => setParts((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
                >
                  {BODY_PART_META[p].name}
                </Chip>
              ))}
            </div>
          </div>
          <SectionTitle title="动作与预设组数" />
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={item.exerciseId} className="rounded-2xl bg-surface p-3 ring-1 ring-line">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{item.exerciseName || <TemplateName exerciseId={item.exerciseId} />}</span>
                  <button
                    onClick={() => setItems((cur) => cur.filter((_, i) => i !== idx))}
                    className="rounded-lg p-1 text-ink-3 hover:text-danger"
                    aria-label="移除动作"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  {item.weightType !== 'bodyweight' && (
                    <input
                      value={item.weight}
                      onChange={(e) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, weight: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                      inputMode="decimal"
                      className="num h-10 w-20 rounded-xl bg-surface-2 px-2 text-center text-sm outline-none ring-1 ring-line"
                      placeholder="kg"
                    />
                  )}
                  <input
                    value={item.reps}
                    onChange={(e) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, reps: e.target.value.replace(/[^\d]/g, '') } : x)))}
                    inputMode="numeric"
                    className="num h-10 w-16 rounded-xl bg-surface-2 px-2 text-center text-sm outline-none ring-1 ring-line"
                    placeholder="次数"
                  />
                  <input
                    value={item.count}
                    onChange={(e) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, count: e.target.value.replace(/[^\d]/g, '') } : x)))}
                    inputMode="numeric"
                    className="num h-10 w-16 rounded-xl bg-surface-2 px-2 text-center text-sm outline-none ring-1 ring-line"
                    placeholder="组数"
                  />
                  <span className="num flex items-center text-xs text-ink-3">kg × 次 × 组</span>
                </div>
              </div>
            ))}
            <Button variant="secondary" block onClick={() => setPickerOpen(true)}>
              <Plus size={16} /> 添加动作
            </Button>
          </div>
        </div>
      </div>
      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pick} />
    </>
  )
}
