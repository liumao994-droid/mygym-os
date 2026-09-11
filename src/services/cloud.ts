import { activeUserId, getAppState, getLegacyDb, setAppState } from '@/db/db'
import type { BackupFile, CloudMigrationState } from '@/db/models'
import { api, loadStoredAuth, type ImportResponse, type StoredAuth } from '@/services/api'
import { createBackup, importBackup } from '@/services/io'

function requireActiveUser(): void {
  if (!activeUserId) throw new Error('请先登录后再使用云端同步')
}

/**
 * 云端操作必须固定使用同一个 token 快照，并在请求前后确认它仍属于当前本地数据库。
 * 防止其他标签切换账号时把 A 的本地资料上传到 B 的云端账号。
 */
function currentAuthSnapshot(): StoredAuth {
  requireActiveUser()
  const auth = loadStoredAuth()
  if (!auth || auth.user.id !== activeUserId) throw new Error('账号状态已变化，请重新登录后再同步')
  return auth
}

function assertSnapshotCurrent(auth: StoredAuth): void {
  const current = loadStoredAuth()
  if (!activeUserId || current?.token !== auth.token || current.user.id !== activeUserId) {
    throw new Error('账号状态已变化，已取消同步操作')
  }
}

async function verifyCloudIdentity(auth: StoredAuth): Promise<void> {
  assertSnapshotCurrent(auth)
  const { user } = await api.me(auth)
  if (user.id !== activeUserId) throw new Error('本地账号与登录身份不一致，已拒绝同步')
  assertSnapshotCurrent(auth)
}

/** 认领旧单用户资料：只复制到当前账号，遗留资料库始终保留。 */
export async function adoptLegacyData(): Promise<Record<string, number>> {
  requireActiveUser()
  const legacy = getLegacyDb()
  const [exercises, sessions, workoutExercises, sets, dailyStatuses, templates, personalRecords, prEvents, activitySessions, appState] = await Promise.all([
    legacy.exercises.toArray(),
    legacy.sessions.toArray(),
    legacy.workoutExercises.toArray(),
    legacy.sets.toArray(),
    legacy.dailyStatuses.toArray(),
    legacy.templates.toArray(),
    legacy.personalRecords.toArray(),
    legacy.prEvents.toArray(),
    legacy.activitySessions.toArray(),
    legacy.appState.toArray(),
  ])
  const backup: BackupFile = {
    app: 'MyGymOS',
    schema: 2,
    exportedAt: new Date().toISOString(),
    unit: 'kg',
    data: {
      exercises,
      sessions,
      workoutExercises,
      sets,
      dailyStatuses,
      templates,
      personalRecords,
      prEvents,
      activitySessions,
      // 主题/单位等设备设置随账号迁移；账号昵称和旧 AI 配置不覆盖新身份。
      appState: appState.filter((row) => row.key !== 'aiConfig' && row.key !== 'nickname'),
    },
  }
  await importBackup(backup, 'merge')
  const counts = { exercises: exercises.length, sessions: sessions.length, workoutExercises: workoutExercises.length, sets: sets.length, dailyStatuses: dailyStatuses.length, templates: templates.length, personalRecords: personalRecords.length, prEvents: prEvents.length, activitySessions: activitySessions.length }
  return counts
}

export async function getCloudMigrationState(): Promise<CloudMigrationState> {
  return getAppState<CloudMigrationState>('cloudMigrationState', { status: 'idle', localAdopted: false, cloudUploaded: false })
}

/** 首次迁移：先认领本地旧数据，再上传当前账号；任一步失败都不删除本地资料。 */
export async function migrateLegacyToCloud(): Promise<CloudMigrationState> {
  requireActiveUser()
  const old = await getCloudMigrationState()
  const running: CloudMigrationState = { ...old, status: 'running', startedAt: Date.now(), error: undefined }
  await setAppState('cloudMigrationState', running)
  try {
    const counts = old.localAdopted ? old.counts ?? {} : await adoptLegacyData()
    const upload = await syncToCloud()
    const done: CloudMigrationState = {
      status: 'done',
      localAdopted: true,
      cloudUploaded: true,
      counts: { ...counts, cloudImported: Object.values(upload.imported).reduce((total, n) => total + n, 0) },
      startedAt: running.startedAt,
      finishedAt: Date.now(),
    }
    await setAppState('cloudMigrationState', done)
    return done
  } catch (error) {
    const failed: CloudMigrationState = { ...running, status: 'failed', error: error instanceof Error ? error.message : String(error) }
    await setAppState('cloudMigrationState', failed)
    throw error
  }
}

/** 显式上传当前资料库；服务端按 token 强制归属并拒绝越权记录。 */
export async function syncToCloud(): Promise<ImportResponse> {
  const auth = currentAuthSnapshot()
  await verifyCloudIdentity(auth)
  const backup = await createBackup()
  assertSnapshotCurrent(auth)
  return api.importData(backup, auth)
}

/** 从当前账号的云端资料合并到本机，不清空本地记录。 */
export async function restoreFromCloud() {
  const auth = currentAuthSnapshot()
  await verifyCloudIdentity(auth)
  const backup = await api.exportData(auth)
  assertSnapshotCurrent(auth)
  return importBackup(backup, 'merge')
}
