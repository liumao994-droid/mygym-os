import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Plus } from 'lucide-react'
import { db } from '@/db/db'
import { BODY_PARTS, BODY_PART_META, type BodyPartId, type Exercise } from '@/db/models'
import { Sheet, Chip } from './ui/basic'
import { createExercise } from '@/services/repo'
import { toast } from '@/store/settings'

/** 动作选择器:搜索 + 部位过滤 + 新建动作,全 App 复用 */
export function ExercisePicker({
  open,
  onClose,
  onPick,
  title = '选择动作',
}: {
  open: boolean
  onClose: () => void
  onPick: (exercise: Exercise) => void
  title?: string
}) {
  const [query, setQuery] = useState('')
  const [partFilter, setPartFilter] = useState<BodyPartId | null>(null)

  const exercises = useLiveQuery(
    () => db.exercises.filter((e) => !e.deletedAt).toArray(),
    [],
    [] as Exercise[],
  ) ?? []

  const filtered = useMemo(() => {
    let list = exercises
    if (partFilter) list = list.filter((e) => e.bodyPart === partFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((e) => e.name.toLowerCase().includes(q))
    }
    return list.sort((a, b) => BODY_PARTS.indexOf(a.bodyPart) - BODY_PARTS.indexOf(b.bodyPart) || a.name.localeCompare(b.name, 'zh'))
  }, [exercises, partFilter, query])

  async function handleCreate() {
    const name = query.trim()
    if (!name) {
      toast('输入动作名称后再添加', 'error')
      return
    }
    try {
      const ex = await createExercise({
        name,
        bodyPart: partFilter ?? 'chest',
      })
      toast(`已添加「${ex.name}」`)
      setQuery('')
      onPick(ex)
    } catch (e) {
      toast(e instanceof Error ? e.message : '添加失败', 'error')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="sticky top-0 z-10 space-y-2.5 bg-bg-elev pb-2">
        <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3.5 py-2.5">
          <Search size={17} className="shrink-0 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索动作,如「下拉」"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
            autoFocus={false}
          />
          {query.trim() && (
            <button
              onClick={handleCreate}
              className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink active:scale-95"
            >
              <Plus size={13} /> 添加「{query.trim().slice(0, 6)}{query.trim().length > 6 ? '…' : ''}」
            </button>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip selected={partFilter === null} onClick={() => setPartFilter(null)} className="shrink-0">
            全部
          </Chip>
          {BODY_PARTS.map((p) => (
            <Chip
              key={p}
              selected={partFilter === p}
              color={BODY_PART_META[p].color}
              onClick={() => setPartFilter(partFilter === p ? null : p)}
              className="shrink-0"
            >
              {BODY_PART_META[p].name}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-1 pb-6">
        {filtered.length === 0 && !query && (
          <p className="py-10 text-center text-sm text-ink-3">输入名称,直接创建属于你的动作</p>
        )}
        {filtered.length === 0 && query && (
          <button
            onClick={handleCreate}
            className="flex w-full items-center gap-3 rounded-2xl bg-surface-2 p-3.5 text-left active:scale-[0.99]"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent-dim text-accent">
              <Plus size={18} />
            </span>
            <span>
              <span className="block text-[15px] font-medium">创建「{query.trim()}」</span>
              <span className="block text-xs text-ink-3">
                归属:{partFilter ? BODY_PART_META[partFilter].name : '胸'}(可稍后在动作管理中修改)
              </span>
            </span>
          </button>
        )}
        {filtered.map((ex) => (
          <button
            key={ex.id}
            onClick={() => onPick(ex)}
            className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-surface-2 active:scale-[0.99]"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
              style={{ backgroundColor: `${BODY_PART_META[ex.bodyPart].color}1f`, color: BODY_PART_META[ex.bodyPart].color }}
            >
              {BODY_PART_META[ex.bodyPart].name}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{ex.name}</span>
              <span className="block text-xs text-ink-3">
                {BODY_PART_META[ex.bodyPart].name}
                {ex.isCustom ? ' · 自定义' : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
