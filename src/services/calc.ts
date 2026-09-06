import type { WeightType, WorkoutSet } from '@/db/models'
import { fmtWeight } from '@/lib/util'

/**
 * 基础计算层 —— 全部本地计算,不依赖 AI。
 * 所有重量底层单位为 kg。
 */

export const LB_PER_KG = 2.2046226218
export const KG_PER_LB = 0.45359237

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG
}
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

/** 按显示单位转换数值(kg 底层 → 显示层) */
export function toDisplayWeight(kg: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? kg : kgToLb(kg)
}
/** 显示单位 → 底层 kg */
export function fromDisplayWeight(v: number, unit: 'kg' | 'lb'): number {
  const r = unit === 'kg' ? v : lbToKg(v)
  return Math.round(r * 1000) / 1000
}

/** Epley 公式估算 1RM。次数过高(>15)时结果失真,返回 null 不参与判定 */
export function estimate1RM(weightKg: number, reps: number): number | null {
  if (weightKg <= 0 || reps <= 0) return null
  if (reps > 15) return null
  return Math.round(weightKg * (1 + reps / 30) * 100) / 100
}

/**
 * 单组训练容量:
 * - 器械/杠铃/哑铃:重量 × 次数(哑铃按单只重量计,与主流健身 App 一致)
 * - 自重:不计入公斤容量(单独统计 组×次)
 * - 辅助:辅助重量不等于负载,不计入公斤容量
 */
export function setVolume(set: Pick<WorkoutSet, 'weight' | 'reps' | 'weightType'>): number {
  if (set.weightType !== 'weight' && set.weightType !== 'dumbbell') return 0
  if (set.weight <= 0 || set.reps <= 0) return 0
  return Math.round(set.weight * set.reps * 100) / 100
}

/** 组数与次数统计(自重/辅助也计数) */
export function setWork(set: Pick<WorkoutSet, 'reps'>): number {
  return Math.max(0, set.reps)
}

/**
 * 「表现分」:跨组比较用的统一指标。
 * - 有重量:优先 估算1RM;1RM 不可用(次数>15)时退化为 重量×0.5+次数 权衡分
 * - 自重:次数
 * - 辅助:辅助越少表现越好 → 用 -weight(辅助 kg)与 reps 组合
 */
export function performanceScore(set: Pick<WorkoutSet, 'weight' | 'reps' | 'weightType'>): number {
  if (set.weightType === 'bodyweight') return set.reps
  if (set.weightType === 'assisted') {
    // 辅助越少越好;同辅助下次数越多越好。以 (30-辅助)×... 简化为:1RM 方向取反
    const eff = -set.weight // 20 → 辅助20kg
    return 10000 - eff * 10 + set.reps * 0.1 // 保证低辅助 > 高辅助
  }
  const oneRm = estimate1RM(set.weight, set.reps)
  if (oneRm !== null) return oneRm
  // 次数>15:粗略等效分,避免完全不可比
  return set.weight * (1 + 15 / 30) + (set.reps - 15) * set.weight * 0.01
}

/** 一组的人类可读描述,如「55kg × 10」或「-20kg × 8」或「自重 × 12」 */
export function describeSet(set: Pick<WorkoutSet, 'weight' | 'reps' | 'weightType'>): string {
  if (set.weightType === 'bodyweight') return `自重 × ${set.reps}`
  if (set.weightType === 'assisted') return `-${fmtWeight(Math.abs(set.weight))}kg × ${set.reps}`
  return `${fmtWeight(set.weight)}kg × ${set.reps}`
}

/** 该组是否为「有重量」组(用于容量/1RM 图表过滤) */
export function isWeightedType(t: WeightType): boolean {
  return t === 'weight' || t === 'dumbbell'
}

/** RPE → 感受等级粗略映射(可选展示) */
export function rpeToFeel(rpe: number): 1 | 2 | 3 | 4 | 5 {
  if (rpe <= 4) return 1
  if (rpe <= 6) return 2
  if (rpe <= 7.5) return 3
  if (rpe <= 9) return 4
  return 5
}
