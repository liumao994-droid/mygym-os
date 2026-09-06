/**
 * MyGym OS — 数据模型
 *
 * 设计原则:
 * - 主键统一使用字符串 UUID,便于未来云同步 / 多端合并
 * - 所有重量统一以 kg 存储(底层标准单位),lb 仅为显示层转换
 * - WorkoutSet 冗余 sessionId / exerciseId / date,使 PR 与统计查询走索引,
 *   万级数据量下依然高效
 * - 训练组逐组保存(不折叠),UI 层负责把相同数据折叠展示
 * - 删除动作使用软删除(deletedAt),历史记录关联永不丢失
 */

export type ID = string

/** 六大一级训练部位(固定,不擅自扩展) */
export const BODY_PARTS = ['chest', 'shoulders', 'back', 'biceps', 'triceps', 'legs'] as const
export type BodyPartId = (typeof BODY_PARTS)[number]

export interface BodyPartMeta {
  id: BodyPartId
  name: string
  color: string
}

/**
 * 六部位色板:Deep Sea Blue 谱系,明度阶梯区分,
 * 深浅双模式下均保持辨识度,不引入彩虹色。
 */
export const BODY_PART_META: Record<BodyPartId, BodyPartMeta> = {
  chest: { id: 'chest', name: '胸', color: '#4A63C4' },
  shoulders: { id: 'shoulders', name: '肩', color: '#6F8FD8' },
  back: { id: 'back', name: '背', color: '#2E4AAE' },
  biceps: { id: 'biceps', name: '二头', color: '#7C93D6' },
  triceps: { id: 'triceps', name: '三头', color: '#64749B' },
  legs: { id: 'legs', name: '腿', color: '#223A8C' },
}

/**
 * 运动类型注册表(可扩展):
 * 现有 strength = 力量训练(sessions/sets 体系);
 * 其它运动通过 activitySessions 通用表记录,新增运动只需在此注册并扩展对应统计。
 */
export const SPORT_TYPES = ['strength', 'badminton', 'swimming', 'tennis'] as const
export type SportType = (typeof SPORT_TYPES)[number]

export interface SportMeta {
  id: SportType
  name: string
  emoji: string
  color: string
  /** 入口副标题:这个运动记录什么 */
  desc: string
  /** 页面路由基路径(strength 为 /train) */
  routeBase: string
  /** 历史筛选器短标签 */
  label: string
  /** 可选:仅此运动入口卡片展示的隐藏小签名(如 Evan) */
  easterEgg?: string
}

/**
 * 运动注册表 —— 新增运动的唯一必改点(除运动自己的页面模块):
 * 在此注册后,首页入口/训练页卡片/历史筛选/记录运动弹层自动识别。
 */
export const SPORT_META: Record<SportType, SportMeta> = {
  strength: {
    id: 'strength', name: '力量训练', emoji: '🏋️', color: '#6F8FD8',
    desc: '部位 · 动作 · 组数重量', routeBase: '/train', label: '🏋️ 力量',
  },
  badminton: {
    id: 'badminton', name: '羽毛球', emoji: '🏸', color: '#63B3A4',
    desc: '时长 · 单双打 · 局数胜负', routeBase: '/badminton', label: '🏸 羽毛球',
  },
  swimming: {
    id: 'swimming', name: '游泳', emoji: '🏊', color: '#5FB0CE',
    desc: '距离 · 泳姿 · 自动配速', routeBase: '/swimming', label: '🏊 游泳',
  },
  tennis: {
    id: 'tennis', name: '网球', emoji: '🎾', color: '#A3C585',
    desc: '时长 · 单双打 · 盘数胜负', routeBase: '/tennis', label: '🎾 网球',
    /** 隐藏彩蛋:仅网球卡片展示的小签名(不参与布局与交互) */
    easterEgg: 'Evan',
  },
}

/** 泳姿 */
export const STROKE_TYPES = ['freestyle', 'breaststroke', 'backstroke', 'butterfly', 'medley', 'other'] as const
export type StrokeType = (typeof STROKE_TYPES)[number]
export const STROKE_LABEL: Record<StrokeType, string> = {
  freestyle: '自由泳',
  breaststroke: '蛙泳',
  backstroke: '仰泳',
  butterfly: '蝶泳',
  medley: '混合泳',
  other: '其他',
}

/** 距离单位:底层统一存储米,unit 仅记录用户输入习惯 */
export type DistanceUnit = 'm' | 'mi'

export type NonStrengthSport = Exclude<SportType, 'strength'>

/** 对抗类运动的计分容器(局数/胜负/得分),字段全部可选 */
export interface ActivityScore {
  gamesTotal?: number
  gamesWon?: number
  gamesLost?: number
  pointsTotal?: number
}

/** 通用运动记录(羽毛球等非力量运动) */
export interface ActivitySession {
  id: ID
  sport: NonStrengthSport
  /** 本地日期 YYYY-MM-DD */
  date: string
  /** 开始时间戳(可选) */
  startTime?: number
  /** 持续分钟数(可选) */
  durationMin?: number
  venue?: string
  playType?: 'singles' | 'doubles'
  /** 对手/搭档(自由文本,可选) */
  partners?: string
  /** 是否为比赛 */
  isMatch?: 1
  score?: ActivityScore
  /** 比分文本(网球等,可选,如「6-4 3-6 7-5」) */
  scoreText?: string
  /* ---- 网球(全部可选) ---- */
  /** 室内 / 室外 */
  indoor?: 'indoor' | 'outdoor'
  /** 场地类型 */
  surface?: 'hard' | 'clay' | 'grass' | 'other'
  /** 记录性质:训练 / 正式比赛 / 友谊赛 / 练习赛 / 发球训练 / 多球训练 / 其他 */
  nature?: 'training' | 'official' | 'friendly' | 'practice' | 'serving' | 'multiball' | 'other'
  /** 训练模式多选(发球/正手/反手/截击/…) */
  trainingTypes?: string[]
  /** 今天主要训练内容(自由文本) */
  trainingFocus?: string
  /** 多盘比分:Set 1: A-B(可只填一侧) */
  sets?: { a: number; b: number }[]
  /** 技术统计(全部手动填写,全可选) */
  technique?: {
    firstServeIn?: number
    firstServePoints?: number
    doubleFaults?: number
    aces?: number
    serveGames?: number
    servePointsWon?: number
    returnPointsWon?: number
    breakPoints?: number
    breakConverted?: number
    netPointsWon?: number
    winners?: number
    unforcedErrors?: number
  }
  /** 体能数据(手动记录,全可选) */
  fitness?: {
    runMinutes?: number
    runDistanceM?: number
    avgHr?: number
    maxHr?: number
  }
  /* ---- 游泳字段(全部可选) ---- */
  /** 距离,底层统一为米 */
  distanceM?: number
  /** 用户输入时使用的距离单位(显示层换算用) */
  distanceUnit?: DistanceUnit
  stroke?: StrokeType
  /** 泳池长度(米);非标池直接存米数 */
  poolLengthM?: number
  /** 趟数/圈数 */
  laps?: number
  /** 消耗热量(kcal,可选) */
  calories?: number
  rpe?: number
  notes?: string
  isDemo?: 1
  createdAt: number
  updatedAt: number
}

/** 重量形式 */
export type WeightType =
  | 'weight' // 器械 / 杠铃 / 绳索等,按总重量计
  | 'dumbbell' // 单只哑铃(显示 20kg/只)
  | 'bodyweight' // 自重(不填重量)
  | 'assisted' // 辅助重量,存储为负值,显示 -20kg

export const WEIGHT_TYPE_LABEL: Record<WeightType, string> = {
  weight: '重量',
  dumbbell: '哑铃/只',
  bodyweight: '自重',
  assisted: '辅助',
}

export type EquipmentId =
  | 'machine'
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'bodyweight'
  | 'assisted'
  | 'other'

export type SessionStatus = 'active' | 'completed'

export type FeelLevel = 1 | 2 | 3 | 4 | 5

export const FEEL_LABEL: Record<FeelLevel, string> = {
  1: '非常轻松',
  2: '轻松',
  3: '正常',
  4: '困难',
  5: '非常困难',
}

/** 动作 */
export interface Exercise {
  id: ID
  name: string
  bodyPart: BodyPartId
  equipment: EquipmentId
  /** 该动作默认的重量形式,输入时自动带入 */
  defaultWeightType: WeightType
  isCustom: boolean
  /** 软删除:历史数据仍可关联展示 */
  deletedAt?: number
  createdAt: number
  updatedAt: number
}

/** 一次训练(会话) */
export interface WorkoutSession {
  id: ID
  /** 本地日期 YYYY-MM-DD(与 createdAt 时区一致) */
  date: string
  status: SessionStatus
  bodyParts: BodyPartId[]
  /** 展示用标题,如「背 + 二头」;为空时按 bodyParts 生成 */
  title?: string
  notes?: string
  feel?: FeelLevel
  durationSec?: number
  startedAt: number
  completedAt?: number
  /** 复制来源(上次训练) */
  copiedFromSessionId?: ID
  templateId?: ID
  /** Demo 数据标记:可与真实数据区分、一键清除 */
  isDemo?: 1
  createdAt: number
  updatedAt: number
}

/** 训练中的某个动作条目 */
export interface WorkoutExercise {
  id: ID
  sessionId: ID
  exerciseId: ID
  order: number
  note?: string
  createdAt: number
}

/** 单组数据 —— 永不折叠的底层事实 */
export interface WorkoutSet {
  id: ID
  workoutExerciseId: ID
  /** 冗余字段,用于索引查询 */
  sessionId: ID
  exerciseId: ID
  setNumber: number
  /** kg;辅助重量为负数(如 -20);自重为 0 */
  weight: number
  reps: number
  weightType: WeightType
  rpe?: number
  /** 冗余日期,用于按月统计 */
  date: string
  isDemo?: 1
  createdAt: number
}

/** 日状态:无记录 = unrecorded(无行);主动休息 = rest */
export interface DailyStatus {
  date: string
  status: 'rest'
  note?: string
  isDemo?: 1
}

/** 训练模板 */
export interface WorkoutTemplate {
  id: ID
  name: string
  bodyParts: BodyPartId[]
  items: {
    exerciseId: ID
    /** 预设组:同参数折叠 {weight,reps,count} */
    sets: { weight: number; reps: number; count: number; weightType: WeightType }[]
  }[]
  isDemo?: 1
  createdAt: number
  updatedAt: number
}

/** PR 类型 */
export type PRType = 'maxWeight' | 'maxReps' | 'est1rm' | 'volume'

export const PR_TYPE_LABEL: Record<PRType, string> = {
  maxWeight: '最大重量',
  maxReps: '最大次数',
  est1rm: '估算 1RM',
  volume: '单次训练容量',
}

/** 个人纪录(每个 动作+类型 一行,变更时重算) */
export interface PersonalRecord {
  id: string // `${exerciseId}:${type}`
  exerciseId: ID
  type: PRType
  value: number
  weight: number
  reps: number
  sets?: number
  date: string
  sessionId: ID
  updatedAt: number
}

/** PR 事件日志(只追加),用于里程碑 / 「最近进步」/ 新 PR 庆祝 */
export interface PREvent {
  id: ID
  exerciseId: ID
  type: PRType
  value: number
  weight: number
  reps: number
  weightType: WeightType
  prevValue: number | null
  date: string
  sessionId: ID
  isDemo?: 1
  createdAt: number
}

/** AI 生成的深度分析缓存(仅在用户主动点击时写入) */
export interface AIAnalysis {
  id: string // e.g. `month:2026-09` / `year:2026`
  kind: 'month' | 'year'
  period: string
  content: string
  model?: string
  createdAt: number
}

/** 通用 KV(设置、引导状态、提醒关闭记录等) */
export interface AppStateRow {
  key: string
  value: unknown
  updatedAt: number
}

/** 导出文件结构(版本化,便于未来迁移) */
export interface BackupFile {
  app: 'MyGymOS'
  schema: 2
  exportedAt: string
  unit: 'kg' | 'lb'
  data: {
    exercises: Exercise[]
    sessions: WorkoutSession[]
    /** schema 2 起新增;旧备份导入时缺失则视为空 */
    activitySessions?: ActivitySession[]
    workoutExercises: WorkoutExercise[]
    sets: WorkoutSet[]
    dailyStatuses: DailyStatus[]
    templates: WorkoutTemplate[]
    personalRecords: PersonalRecord[]
    prEvents: PREvent[]
    appState: AppStateRow[]
  }
}
