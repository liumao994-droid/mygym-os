import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Search, X } from 'lucide-react'
import { db } from '@/db/db'
import { BODY_PARTS, BODY_PART_META, type BodyPartId } from '@/db/models'
import { cn, fmtWeight } from '@/lib/util'
import { toDisplayWeight } from '@/services/calc'
import { getExerciseUsageMap } from '@/services/stats'
import { Card, Chip, PageHeader, EmptyState } from '@/components/ui/basic'
import { BrandWatermark } from '@/components/BrandWatermark'
import { ExerciseEditSheet } from './ExerciseDetailPage'
import { useSettings } from '@/store/settings'

type SortKey = 'recent' | 'count' | 'best' | 'name'

/** 我的动作:搜索 / 部位过滤 / 排序 / 添加编辑删除 */
export default function ExercisesPage() {
  const navigate = useNavigate()
  const { unit } = useSettings()
  const [query, setQuery] = useState('')
  const [partFilter, setPartFilter] = useState<BodyPartId | null>(null)
  const [sort, setSort] = useState<SortKey>('recent')
  const [editSheet, setEditSheet] = useState<{ open: boolean; initial: { id?: string; name: string; bodyPart: BodyPartId } }>({
    open: false,
    initial: { name: '', bodyPart: 'chest' },
  })

  const exercises = useLiveQuery(() => db.exercises.filter((e) => !e.deletedAt).toArray(), [], undefined)
  const usage = useLiveQuery(() => getExerciseUsageMap(), [], undefined)

  const list = useMemo(() => {
    if (!exercises) return []
    let l = exercises
    if (partFilter) l = l.filter((e) => e.bodyPart === partFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      l = l.filter((e) => e.name.toLowerCase().includes(q))
    }
    const u = usage ?? new Map()
    return [...l].sort((a, b) => {
      const ua = u.get(a.id)
      const ub = u.get(b.id)
      if (sort === 'recent') return (ub?.lastUsed ?? '').localeCompare(ua?.lastUsed ?? '')
      if (sort === 'count') return (ub?.useCount ?? 0) - (ua?.useCount ?? 0)
      if (sort === 'best') return (ub?.bestEst1rm ?? 0) - (ua?.bestEst1rm ?? 0)
      return a.name.localeCompare(b.name, 'zh')
    })
  }, [exercises, usage, partFilter, query, sort])

  const SORTS: { key: SortKey; label: string }[] = [
    { key: 'recent', label: '最近使用' },
    { key: 'count', label: '使用次数' },
    { key: 'best', label: '历史最佳' },
    { key: 'name', label: '名称' },
  ]

  return (
    <div className="min-h-dvh overflow-clip isolate relative bg-bg pb-28">
      <BrandWatermark size="page" pos="tr" />
      <PageHeader
        title="我的动作"
        subtitle={`${exercises?.length ?? 0} 个动作 · 点按查看力量历史`}
        right={
          <button
            onClick={() => setEditSheet({ open: true, initial: { name: '', bodyPart: partFilter ?? 'chest' } })}
            className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-ink active:scale-95"
            aria-label="添加动作"
          >
            <Plus size={19} />
          </button>
        }
      />

      <div className="mx-auto max-w-2xl space-y-2.5 px-4">
        {/* 搜索 */}
        <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3.5 py-2.5">
          <Search size={17} className="shrink-0 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索动作"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-ink-3" aria-label="清除搜索">
              <X size={15} />
            </button>
          )}
        </div>

        {/* 部位过滤 */}
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

        {/* 排序 */}
        <div className="flex gap-1.5 text-xs">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={cn(
                'rounded-full px-3 py-1.5 font-medium transition-colors',
                sort === s.key ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {exercises !== undefined && list.length === 0 && (
          <EmptyState
            icon="🔍"
            title={query ? '没有匹配的动作' : '还没有动作'}
            desc={query ? '换个关键词,或添加一个新动作' : '添加你的第一个动作'}
            actionText="添加动作"
            onAction={() => setEditSheet({ open: true, initial: { name: query, bodyPart: partFilter ?? 'chest' } })}
          />
        )}

        <div className="space-y-2">
          {list.map((ex) => {
            const meta = BODY_PART_META[ex.bodyPart]
            const u = usage?.get(ex.id)
            const bestW = u?.bestWeight ?? 0
            return (
              <Card key={ex.id} onClick={() => navigate(`/exercise/${ex.id}`)} className="!p-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                    style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
                  >
                    {meta.name}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{ex.name}</div>
                    <div className="num text-xs text-ink-3">
                      {u ? `练过 ${u.useCount} 次${bestW > 0 ? ` · 最佳 ${fmtWeight(Math.round(toDisplayWeight(bestW, unit) * 10) / 10)}${unit}` : ''}` : '还没练过'}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <ExerciseEditSheet
        open={editSheet.open}
        onClose={() => setEditSheet((s) => ({ ...s, open: false }))}
        initial={editSheet.initial}
      />
    </div>
  )
}
