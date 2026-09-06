import { db, setAppState } from '@/db/db'
import type { BodyPartId, WeightType, WorkoutExercise, WorkoutSession, WorkoutSet } from '@/db/models'
import { addDays, todayStr, uid } from '@/lib/util'
import { rebuildAllPRs } from './pr'

/**
 * Demo 数据种子:生成约 3 个月的真实感训练数据(带渐进负荷),
 * 全部标记 isDemo:1,可在设置中一键清除,不会与真实数据混淆。
 */

interface DemoExercisePlan {
  name: string
  baseWeight: number // 起始重量 kg
  weeklyGain: number // 每周进步 kg
  reps: number
  sets: number
  weightType: WeightType
  /** 变化幅度:每次训练 reps 有概率 ±1 */
  repVariance?: boolean
}

interface DemoDay {
  parts: BodyPartId[]
  label: string
  exercises: DemoExercisePlan[]
}

const DEMO_PLAN: DemoDay[] = [
  {
    label: '背 + 二头',
    parts: ['back', 'biceps'],
    exercises: [
      { name: '高位下拉', baseWeight: 45, weeklyGain: 0.8, reps: 10, sets: 4, weightType: 'weight', repVariance: true },
      { name: '坐姿划船', baseWeight: 35, weeklyGain: 0.6, reps: 12, sets: 4, weightType: 'weight', repVariance: true },
      { name: '单臂哑铃划船', baseWeight: 17.5, weeklyGain: 0.4, reps: 10, sets: 3, weightType: 'dumbbell' },
      { name: '哑铃弯举', baseWeight: 10, weeklyGain: 0.3, reps: 12, sets: 4, weightType: 'dumbbell', repVariance: true },
      { name: '锤式弯举', baseWeight: 10, weeklyGain: 0.25, reps: 10, sets: 3, weightType: 'dumbbell' },
    ],
  },
  {
    label: '胸 + 三头',
    parts: ['chest', 'triceps'],
    exercises: [
      { name: '杠铃卧推', baseWeight: 50, weeklyGain: 0.9, reps: 8, sets: 4, weightType: 'weight', repVariance: true },
      { name: '上斜哑铃卧推', baseWeight: 20, weeklyGain: 0.5, reps: 10, sets: 4, weightType: 'dumbbell' },
      { name: '蝴蝶机夹胸', baseWeight: 30, weeklyGain: 0.5, reps: 12, sets: 3, weightType: 'weight' },
      { name: '绳索下压', baseWeight: 25, weeklyGain: 0.5, reps: 12, sets: 4, weightType: 'weight' },
      { name: '双杠臂屈伸', baseWeight: 0, weeklyGain: 0, reps: 10, sets: 3, weightType: 'bodyweight', repVariance: true },
    ],
  },
  {
    label: '腿',
    parts: ['legs'],
    exercises: [
      { name: '杠铃深蹲', baseWeight: 60, weeklyGain: 1.0, reps: 8, sets: 4, weightType: 'weight', repVariance: true },
      { name: '腿举', baseWeight: 120, weeklyGain: 2.0, reps: 12, sets: 4, weightType: 'weight' },
      { name: '腿弯举', baseWeight: 35, weeklyGain: 0.6, reps: 12, sets: 3, weightType: 'weight' },
      { name: '腿屈伸', baseWeight: 40, weeklyGain: 0.6, reps: 12, sets: 3, weightType: 'weight' },
    ],
  },
  {
    label: '肩 + 二头',
    parts: ['shoulders', 'biceps'],
    exercises: [
      { name: '坐姿推肩', baseWeight: 30, weeklyGain: 0.6, reps: 10, sets: 4, weightType: 'weight' },
      { name: '哑铃侧平举', baseWeight: 8, weeklyGain: 0.25, reps: 12, sets: 4, weightType: 'dumbbell' },
      { name: '面拉', baseWeight: 20, weeklyGain: 0.3, reps: 15, sets: 3, weightType: 'weight' },
      { name: '绳索弯举', baseWeight: 20, weeklyGain: 0.4, reps: 12, sets: 3, weightType: 'weight' },
    ],
  },
]

/** 生成 Demo 数据(约 90 天),返回生成的会话数 */
export async function seedDemoData(): Promise<number> {
  const existingDemo = await db.sessions.where('isDemo').equals(1).count()
  if (existingDemo > 0) return 0 // 已有 Demo 数据,不重复生成

  const exercises = await db.exercises.toArray()
  const exByName = new Map(exercises.map((e) => [e.name, e]))
  const today = todayStr()
  const DAYS = 90

  const sessions: WorkoutSession[] = []
  const wes: WorkoutExercise[] = []
  const sets: WorkoutSet[] = []
  const rests: { date: string; status: 'rest'; isDemo?: 1 }[] = []
  const now = Date.now()

  let sessionCount = 0
  // 周计划:周一背二头 / 周三胸三头 / 周五腿 / 周六肩二头(带随机跳过)
  for (let i = DAYS; i >= 1; i--) {
    const date = addDays(today, -i)
    const dow = new Date(date + 'T12:00:00').getDay()
    const weekIdx = Math.floor((DAYS - i) / 7)

    // 计划映射:1→背二头 3→胸三头 5→腿 6→肩二头
    const planIdx = dow === 1 ? 0 : dow === 3 ? 1 : dow === 5 ? 2 : dow === 6 ? 3 : -1
    if (planIdx === -1) continue

    const plan = DEMO_PLAN[planIdx]
    const r = seededRandom(date)

    // 约 12% 跳过(未记录),约 10% 标记为主动休息
    if (r() < 0.12) continue
    if (r() < 0.1) {
      rests.push({ date, status: 'rest', isDemo: 1 })
      continue
    }

    const sessionId = uid()
    const startedAt = new Date(date + 'T19:00:00').getTime()
    sessions.push({
      id: sessionId,
      date,
      status: 'completed',
      bodyParts: plan.parts,
      title: plan.label,
      startedAt,
      completedAt: startedAt + 3600_000 + Math.floor(r() * 1800_000),
      isDemo: 1,
      createdAt: startedAt,
      updatedAt: startedAt,
    })
    sessionCount++

    let order = 0
    for (const ex of plan.exercises) {
      const exRow = exByName.get(ex.name)
      if (!exRow) continue
      const weId = uid()
      wes.push({
        id: weId,
        sessionId,
        exerciseId: exRow.id,
        order: order++,
        createdAt: now,
      })
      // 渐进负荷 + 少量随机波动
      const wobble = r() < 0.2 ? -1 : r() > 0.85 ? 1 : 0
      const weight =
        ex.weightType === 'bodyweight'
          ? 0
          : Math.round((ex.baseWeight + ex.weeklyGain * weekIdx + wobble * (ex.baseWeight * 0.02)) * 2) / 2
      for (let s = 0; s < ex.sets; s++) {
        const reps = Math.max(4, ex.reps + (ex.repVariance && s === ex.sets - 1 && r() < 0.5 ? -1 : 0))
        const setWeight = s === ex.sets - 1 && r() < 0.25 && ex.weightType !== 'bodyweight' ? Math.max(0, weight - (ex.baseWeight * 0.08 > 2.5 ? 5 : 2.5)) : weight
        sets.push({
          id: uid(),
          workoutExerciseId: weId,
          sessionId,
          exerciseId: exRow.id,
          setNumber: s + 1,
          weight: Math.round(setWeight * 10) / 10,
          reps,
          weightType: ex.weightType,
          date,
          isDemo: 1,
          createdAt: startedAt + s * 60000,
        })
      }
    }
  }

  // Demo 模板
  const backEx = exByName.get('高位下拉')
  const rowEx = exByName.get('坐姿划船')
  const curlEx = exByName.get('哑铃弯举')
  if (backEx && rowEx && curlEx) {
    await db.templates.put({
      id: 'tpl-demo-back-biceps',
      name: '背 + 二头 A',
      bodyParts: ['back', 'biceps'],
      items: [
        { exerciseId: backEx.id, sets: [{ weight: 50, reps: 10, count: 4, weightType: 'weight' }] },
        { exerciseId: rowEx.id, sets: [{ weight: 40, reps: 12, count: 4, weightType: 'weight' }] },
        { exerciseId: curlEx.id, sets: [{ weight: 10, reps: 12, count: 4, weightType: 'dumbbell' }] },
      ],
      isDemo: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  await db.transaction('rw', db.sessions, db.workoutExercises, db.sets, db.dailyStatuses, async () => {
    await db.sessions.bulkPut(sessions)
    await db.workoutExercises.bulkPut(wes)
    await db.sets.bulkPut(sets)
    await db.dailyStatuses.bulkPut(rests)
  })
  await setAppState('demoSeededAt', new Date().toISOString())
  await rebuildAllPRs()
  return sessionCount
}

/** 稳定伪随机(同一天结果一致) */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519)
    h = Math.imul(h ^ (h >>> 13), 3266489917)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}
