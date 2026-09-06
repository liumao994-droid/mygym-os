import { db } from '@/db/db'
import { getAppState, setAppState } from '@/db/db'
import type { BodyPartId } from '@/db/models'
import { BODY_PARTS, BODY_PART_META } from '@/db/models'
import { addDays, fmtDateCN, fmtNum, todayStr } from '@/lib/util'
import { setVolume } from './calc'
import { getDayStates } from './stats'

/**
 * 洞察服务:训练规律识别、温和提醒、里程碑。
 * 原则:必须基于真实数据,数据不足就沉默;措辞用「从记录来看……」;
 * 提醒少量、有价值、可关闭,绝不制造打卡焦虑。
 */

export interface Insight {
  id: string
  kind: 'training' | 'bodyPart' | 'strength' | 'pr'
  icon: string
  text: string
  /** 可选跳转 */
  link?: string
}

export interface InsightsOptions {
  remindersEnabled: boolean
}

/* =============== 提醒 =============== */

export async function getInsights(opts: InsightsOptions): Promise<Insight[]> {
  const out: Insight[] = []
  if (opts.remindersEnabled) {
    out.push(...(await trainingGapInsight()), ...(await bodyPartGapInsight()), ...(await plateauInsight()))
  }
  const dismissed = new Set(((await getAppState<string[]>('dismissedInsights', [])) as string[]) ?? [])
  return out.filter((i) => !dismissed.has(i.id))
}

export async function dismissInsight(id: string): Promise<void> {
  const dismissed = ((await getAppState<string[]>('dismissedInsights', [])) as string[]) ?? []
  if (!dismissed.includes(id)) {
    dismissed.push(id)
    await setAppState('dismissedInsights', dismissed)
  }
}

export async function clearDismissedInsights(): Promise<void> {
  await setAppState('dismissedInsights', [])
}

/** 连续多天没有任何记录(且未标记休息)时,温和提醒一次 */
async function trainingGapInsight(): Promise<Insight[]> {
  const today = todayStr()
  const sessions = await db.sessions.where('status').equals('completed').toArray()
  const last = sessions.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? -1 : 1)).at(-1)
  if (!last) return []
  const map = await getDayStates(addDays(today, -6), today)
  let unrecorded = 0
  for (const ds of map.values()) if (ds.kind === 'unrecorded') unrecorded++
  // 最近 7 天完全无记录,且距上次训练 ≥ 4 天才提醒
  const trainedRecently = [...map.values()].some((d) => d.kind === 'trained')
  if (!trainedRecently && unrecorded >= 4) {
    return [
      {
        id: 'ins:trainingGap',
        kind: 'training',
        icon: '💧',
        text: `最近几天没有训练记录(上次是 ${fmtDateCN(last.date)})。想动的时候,随时可以开始。`,
        link: '/train',
      },
    ]
  }
  return []
}

/** 某部位较长时间没有训练(有历史数据才提醒) */
async function bodyPartGapInsight(): Promise<Insight[]> {
  const sessions = await db.sessions.where('status').equals('completed').toArray()
  if (sessions.length < 3) return []
  const today = todayStr()
  const cutoff = addDays(today, -60)
  const recent = sessions.filter((s) => s.date >= cutoff)
  if (recent.length < 3) return []

  const lastDateByPart = new Map<BodyPartId, string>()
  for (const s of recent) {
    for (const p of s.bodyParts) {
      const cur = lastDateByPart.get(p)
      if (!cur || s.date > cur) lastDateByPart.set(p, s.date)
    }
  }
  const hasAllParts = BODY_PARTS.every((p) => lastDateByPart.has(p))
  if (!hasAllParts) return [] // 六个部位都出现过才开始提醒,避免打扰新手

  // 找最久没练的部位
  let oldest: { part: BodyPartId; date: string } | null = null
  for (const [p, date] of lastDateByPart) {
    if (!oldest || date < oldest.date) oldest = { part: p, date }
  }
  if (!oldest) return []
  const localGap = gapDaysBetween(oldest.date, today)
  if (localGap >= 10) {
    return [
      {
        id: `ins:part:${oldest.part}`,
        kind: 'bodyPart',
        icon: '🗓️',
        text: `${BODY_PART_META[oldest.part].name}部已经有 ${localGap} 天没有训练记录(上次 ${fmtDateCN(oldest.date)})。`,
        link: '/train',
      },
    ]
  }
  return []
}

function gapDaysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00')
  const d2 = new Date(b + 'T00:00:00')
  return Math.round((d2.getTime() - d1.getTime()) / 86400000)
}

/** 动作长期没有变化(最近 3 次最佳重量一致) */
async function plateauInsight(): Promise<Insight[]> {
  const today = todayStr()
  const cutoff = addDays(today, -45)
  const sets = await db.sets.where('date').between(cutoff, today, true, true).toArray()
  if (sets.length < 10) return []
  const byEx = new Map<string, typeof sets>()
  for (const s of sets) {
    if (s.weightType !== 'weight' && s.weightType !== 'dumbbell') continue
    const arr = byEx.get(s.exerciseId) ?? []
    arr.push(s)
    byEx.set(s.exerciseId, arr)
  }
  const exs = await db.exercises.toArray()
  const exMap = new Map(exs.map((e) => [e.id, e]))
  for (const [eid, arr] of byEx) {
    if (arr.length < 9) continue
    // 按会话聚合最佳重量
    const bySession = new Map<string, number>()
    for (const s of arr) bySession.set(s.sessionId, Math.max(bySession.get(s.sessionId) ?? 0, s.weight))
    const sessionBests = [...bySession.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([, w]) => w)
    if (sessionBests.length >= 3) {
      const [latest, ...rest] = sessionBests
      if (rest.every((w) => w === latest)) {
        const name = exMap.get(eid)?.name
        if (name) {
          return [
            {
              id: `ins:plateau:${eid}`,
              kind: 'strength',
              icon: '📈',
              text: `${name}最近几次的重量比较稳定(${fmtNum(latest)}kg),可以继续观察,或尝试小幅加重。`,
              link: `/exercise/${eid}`,
            },
          ]
        }
      }
    }
  }
  return []
}

/* =============== 训练规律识别 =============== */

export interface Patterns {
  /** 平均训练间隔(天),null=数据不足 */
  avgGapDays: number | null
  /** 部位频率:最近 28 天每部位次数 */
  partFreq28: { part: BodyPartId; name: string; count: number; gapText: string | null }[]
  /** 月度对比文本 */
  monthCompare: string[]
  strongest: { name: string; est1rm: number } | null
  hasEnoughData: boolean
}

export async function getPatterns(): Promise<Patterns> {
  const today = todayStr()
  const sessions = (await db.sessions.where('status').equals('completed').toArray()).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  )
  const hasEnoughData = sessions.length >= 3

  // 平均间隔:最近 8 次训练的相邻间隔中位数
  let avgGapDays: number | null = null
  const recent = sessions.slice(-8)
  if (recent.length >= 3) {
    const gaps: number[] = []
    for (let i = 1; i < recent.length; i++) gaps.push(gapDaysBetween(recent[i - 1].date, recent[i].date))
    gaps.sort((a, b) => a - b)
    avgGapDays = gaps[Math.floor(gaps.length / 2)]
  }

  // 部位频率(最近28天)
  const cutoff28 = addDays(today, -27)
  const partFreq28 = BODY_PARTS.map((p) => {
    const count = sessions.filter((s) => s.date >= cutoff28 && s.bodyParts.includes(p)).length
    return {
      part: p,
      name: BODY_PART_META[p].name,
      count,
      gapText: count >= 3 ? `约每 ${Math.round(28 / count)} 天一次` : null,
    }
  })

  // 月度对比
  const monthCompare: string[] = []
  const thisMonth = today.slice(0, 7)
  const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7)
  const countIn = (key: string) => sessions.filter((s) => s.date.startsWith(key)).length
  const cur = countIn(thisMonth)
  const prev = countIn(lastMonth)
  if (prev >= 2 && cur >= 2) {
    if (cur > prev) monthCompare.push(`本月已训练 ${cur} 次,比上月同期更规律`)
    else if (cur < prev) monthCompare.push(`本月训练 ${cur} 次,节奏比上月稍缓`)
    else monthCompare.push(`本月训练节奏与上月接近`)
  }

  // 最强动作(估算1RM 最高)
  let strongest: Patterns['strongest'] = null
  const prs = await db.personalRecords.where('type').equals('est1rm').toArray()
  for (const pr of prs) {
    if (!strongest || pr.value > strongest.est1rm) {
      strongest = { name: exMapName(pr.exerciseId), est1rm: pr.value }
    }
  }

  return { avgGapDays, partFreq28, monthCompare, strongest, hasEnoughData }
}

let _exNameCache: Map<string, string> | null = null
export async function warmExerciseNameCache(): Promise<void> {
  const rows = await db.exercises.toArray()
  _exNameCache = new Map(rows.map((r) => [r.id, r.name]))
}
function exMapName(id: string): string {
  return _exNameCache?.get(id) ?? ''
}

/* =============== 里程碑 =============== */

export interface Milestone {
  id: string
  icon: string
  title: string
  detail: string
  achievedAt: string // 日期
  category: 'sessions' | 'weight' | 'volume' | 'pr'
}

const SESSION_TARGETS = [1, 10, 25, 50, 100, 200, 500]
const VOLUME_TARGETS_T = [10, 50, 100, 250, 500, 1000]
const WEIGHT_TARGETS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200]

export async function getMilestones(): Promise<{ achieved: Milestone[]; next: string[] }> {
  const achieved: Milestone[] = []
  const next: string[] = []

  // --- 训练次数 ---
  const sessions = (await db.sessions.where('status').equals('completed').toArray()).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  )
  for (const t of SESSION_TARGETS) {
    if (sessions.length >= t) {
      const m = sessions[t - 1]
      achieved.push({
        id: `ms:sessions:${t}`,
        icon: '🔥',
        title: t === 1 ? '第一次训练' : `训练满 ${t} 次`,
        detail: `${fmtDateCN(m.date)} 完成`,
        achievedAt: m.date,
        category: 'sessions',
      })
    } else {
      next.push(`训练满 ${t} 次(还差 ${t - sessions.length} 次)`)
      break
    }
  }

  // --- 累计训练量 ---
  let vol = 0
  await db.sets.each((s) => {
    vol += setVolume(s)
  })
  const volT = vol / 1000
  for (const t of VOLUME_TARGETS_T) {
    if (volT >= t) {
      achieved.push({
        id: `ms:volume:${t}`,
        icon: '🏋️',
        title: `累计训练量 ${t} 吨`,
        detail: '每一组都是积累',
        achievedAt: todayStr(),
        category: 'volume',
      })
    } else {
      next.push(`累计训练量 ${t} 吨(当前 ${volT.toFixed(1)} 吨)`)
      break
    }
  }

  // --- 动作重量里程碑:取每动作最大重量,报告已达成的目标 ---
  const maxByEx = new Map<string, { weight: number; date: string; name: string }>()
  const exs = await db.exercises.toArray()
  const exMap = new Map(exs.map((e) => [e.id, e]))
  await db.sets.each((s) => {
    if (s.weightType !== 'weight' && s.weightType !== 'dumbbell') return
    const cur = maxByEx.get(s.exerciseId)
    if (!cur || s.weight > cur.weight) {
      maxByEx.set(s.exerciseId, { weight: s.weight, date: s.date, name: exMap.get(s.exerciseId)?.name ?? '' })
    }
  })
  for (const [, info] of maxByEx) {
    const passed = WEIGHT_TARGETS.filter((t) => info.weight >= t).at(-1)
    if (passed !== undefined && passed >= Math.max(20, Math.floor(info.weight / 2))) {
      achieved.push({
        id: `ms:weight:${info.name}:${passed}`,
        icon: '🏆',
        title: `${info.name} 突破 ${passed}kg`,
        detail: `当前最佳 ${fmtNum(info.weight)}kg`,
        achievedAt: info.date,
        category: 'weight',
      })
    }
  }

  // --- PR 数量 ---
  const prCount = await db.prEvents.count()
  const prTargets = [1, 10, 50, 100]
  for (const t of prTargets) {
    if (prCount >= t) {
      achieved.push({
        id: `ms:pr:${t}`,
        icon: '⭐',
        title: t === 1 ? '第一次刷新 PR' : `累计刷新 ${t} 次 PR`,
        detail: '力量在慢慢上涨',
        achievedAt: todayStr(),
        category: 'pr',
      })
    } else {
      next.push(`累计刷新 ${t} 次 PR(当前 ${prCount} 次)`)
      break
    }
  }

  achieved.sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1))
  return { achieved, next: next.slice(0, 3) }
}
