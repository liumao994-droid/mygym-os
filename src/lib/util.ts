import clsx, { type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/* ---------------- ID ---------------- */

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/* ---------------- 本地日期(YYYY-MM-DD) ---------------- */

export function toLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr(): string {
  return toLocalDate(new Date())
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, days: number): string {
  const d = parseLocalDate(s)
  d.setDate(d.getDate() + days)
  return toLocalDate(d)
}

/** '2026-09' 月份键 */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

export function currentMonthKey(): string {
  return todayStr().slice(0, 7)
}

export function daysBetween(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime()
  return Math.round(ms / 86400000)
}

/* ---------------- 中文显示格式 ---------------- */

export function fmtDateCN(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtDateFullCN(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function fmtWeekdayCN(dateStr: string): string {
  return WEEKDAYS[parseLocalDate(dateStr).getDay()]
}

/** '2026-09' → '2026年9月' */
export function fmtMonthCN(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${y}年${m}月`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 分钟数 → 「90 分钟 / 1.5 小时」 */
export function fmtHoursMin(min: number): string {
  return min >= 60 ? `${(min / 60).toFixed(1).replace(/\.0$/, '')} 小时` : `${min} 分钟`
}

export function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}小时${m % 60}分`
  }
  return s > 0 ? `${m}分${s}秒` : `${m}分钟`
}

/* ---------------- 数字与重量 ---------------- */

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 100000) return `${(n / 10000).toFixed(1)}万`
  if (Math.abs(n) >= 10000) return n.toLocaleString('zh-CN')
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, '')
}

/** 重量显示:55 / 57.5 / -20(辅助) */
export function fmtWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : String(parseFloat(kg.toFixed(2)))
}

/** 训练量显示:2000 → 2,000;12000 → 1.2万 */
export function fmtVolume(kg: number): string {
  if (Math.abs(kg) >= 100000) return `${(kg / 10000).toFixed(1)}万kg`
  return `${Math.round(kg).toLocaleString('zh-CN')}kg`
}

export function signed(n: number, digits = 1): string {
  const v = Number(n.toFixed(digits))
  return `${v > 0 ? '+' : ''}${v % 1 === 0 ? v : v.toFixed(digits)}`
}

export function pct(from: number, to: number): number | null {
  if (!from) return null
  return ((to - from) / from) * 100
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 问候语,按当前时间 */
export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/* ---------------- 折叠组(相同 weight×reps 合并) ---------------- */

export interface CollapsedSet {
  weight: number
  reps: number
  count: number
  weightType: string
  firstSetNumber: number
}

export function collapseSets(sets: { weight: number; reps: number; weightType: string; setNumber: number }[]): CollapsedSet[] {
  const out: CollapsedSet[] = []
  for (const s of sets) {
    const last = out[out.length - 1]
    if (last && last.weight === s.weight && last.reps === s.reps && last.weightType === s.weightType) {
      last.count += 1
    } else {
      out.push({ weight: s.weight, reps: s.reps, count: 1, weightType: s.weightType, firstSetNumber: s.setNumber })
    }
  }
  return out
}

/** 「55kg × 10 × 4」格式化 */
export function fmtSetGroup(c: { weight: number; reps: number; count?: number; weightType: string }): string {
  const w =
    c.weightType === 'bodyweight'
      ? '自重'
      : c.weightType === 'assisted'
        ? `-${fmtWeight(Math.abs(c.weight))}kg`
        : `${fmtWeight(c.weight)}kg`
  const base = `${w} × ${c.reps}`
  return c.count && c.count > 1 ? `${base} × ${c.count}` : base
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* ignore */
  }
}
