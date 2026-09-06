import type { BodyPartId, EquipmentId, WeightType } from './models'

/**
 * 内置默认动作库 —— 只是初始种子,不是写死:
 * 用户可自由 添加/修改/删除/改部位。
 */
export interface DefaultExerciseDef {
  name: string
  bodyPart: BodyPartId
  equipment: EquipmentId
  defaultWeightType: WeightType
}

export const DEFAULT_EXERCISES: DefaultExerciseDef[] = [
  // 背
  { name: '高位下拉', bodyPart: 'back', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '坐姿划船', bodyPart: 'back', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '单臂哑铃划船', bodyPart: 'back', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '引体向上', bodyPart: 'back', equipment: 'bodyweight', defaultWeightType: 'bodyweight' },
  { name: '杠铃划船', bodyPart: 'back', equipment: 'barbell', defaultWeightType: 'weight' },
  { name: '直臂下压', bodyPart: 'back', equipment: 'cable', defaultWeightType: 'weight' },
  // 胸
  { name: '杠铃卧推', bodyPart: 'chest', equipment: 'barbell', defaultWeightType: 'weight' },
  { name: '哑铃卧推', bodyPart: 'chest', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '上斜哑铃卧推', bodyPart: 'chest', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '蝴蝶机夹胸', bodyPart: 'chest', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '绳索夹胸', bodyPart: 'chest', equipment: 'cable', defaultWeightType: 'weight' },
  { name: '俯卧撑', bodyPart: 'chest', equipment: 'bodyweight', defaultWeightType: 'bodyweight' },
  // 肩
  { name: '坐姿推肩', bodyPart: 'shoulders', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '哑铃推肩', bodyPart: 'shoulders', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '哑铃侧平举', bodyPart: 'shoulders', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '绳索侧平举', bodyPart: 'shoulders', equipment: 'cable', defaultWeightType: 'weight' },
  { name: '面拉', bodyPart: 'shoulders', equipment: 'cable', defaultWeightType: 'weight' },
  { name: '反向飞鸟', bodyPart: 'shoulders', equipment: 'machine', defaultWeightType: 'weight' },
  // 二头
  { name: '哑铃弯举', bodyPart: 'biceps', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '锤式弯举', bodyPart: 'biceps', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '杠铃弯举', bodyPart: 'biceps', equipment: 'barbell', defaultWeightType: 'weight' },
  { name: '绳索弯举', bodyPart: 'biceps', equipment: 'cable', defaultWeightType: 'weight' },
  { name: '牧师凳弯举', bodyPart: 'biceps', equipment: 'machine', defaultWeightType: 'weight' },
  // 三头
  { name: '绳索下压', bodyPart: 'triceps', equipment: 'cable', defaultWeightType: 'weight' },
  { name: '仰卧臂屈伸', bodyPart: 'triceps', equipment: 'barbell', defaultWeightType: 'weight' },
  { name: '哑铃颈后臂屈伸', bodyPart: 'triceps', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
  { name: '双杠臂屈伸', bodyPart: 'triceps', equipment: 'bodyweight', defaultWeightType: 'bodyweight' },
  { name: '器械下压', bodyPart: 'triceps', equipment: 'machine', defaultWeightType: 'weight' },
  // 腿
  { name: '杠铃深蹲', bodyPart: 'legs', equipment: 'barbell', defaultWeightType: 'weight' },
  { name: '腿举', bodyPart: 'legs', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '腿屈伸', bodyPart: 'legs', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '腿弯举', bodyPart: 'legs', equipment: 'machine', defaultWeightType: 'weight' },
  { name: '罗马尼亚硬拉', bodyPart: 'legs', equipment: 'barbell', defaultWeightType: 'weight' },
  { name: '箭步蹲', bodyPart: 'legs', equipment: 'dumbbell', defaultWeightType: 'dumbbell' },
]

/** 训练感受等级(可选字段) */
export const FEEL_OPTIONS = [
  { value: 1, label: '非常轻松' },
  { value: 2, label: '轻松' },
  { value: 3, label: '正常' },
  { value: 4, label: '困难' },
  { value: 5, label: '非常困难' },
] as const
