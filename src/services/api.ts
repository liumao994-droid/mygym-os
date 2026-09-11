import type { BackupFile, User } from '@/db/models'
import { getAppState, setAppState } from '@/db/db'

/**
 * MyGym API 客户端 —— Web 与未来微信小程序共用的后端契约。
 *
 * 安全边界:
 * - 身份完全由服务端签发的 Bearer token 决定,前端不传 userId。
 * - AI 请求走后端代理(/api/ai/*),API Key 只存在于服务端环境变量,
 *   前端代码、构建产物、localStorage 中永远没有真实 Key。
 * - token 仅保存在本机 localStorage(小程序端等价物为 wx.setStorageSync),
 *   不进入任何导出/备份文件。
 */

export interface ApiError extends Error {
  code: string
  status: number
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    (code === undefined || (e as { code: string }).code === code)
  )
}

/* =============== API Base URL =============== */

export const API_BASE_STATE_KEY = 'apiBaseUrl'

/** 开发模式下未配置时的默认后端地址(本地 MyGym API 服务) */
const DEV_DEFAULT_API_BASE = 'http://localhost:8787'

let apiBaseCache: string | null = null

/** 解析规则:appState 手动覆盖 > 构建时环境变量 > 开发默认(localhost) > 同源 */
export async function getApiBase(): Promise<string> {
  if (apiBaseCache !== null) return apiBaseCache
  const override = await getAppState<string>(API_BASE_STATE_KEY, '')
  apiBaseCache = normalizeBase(
    override.trim() || (import.meta.env?.VITE_API_BASE_URL as string | undefined) || (import.meta.env?.DEV ? DEV_DEFAULT_API_BASE : ''),
  )
  return apiBaseCache
}

/** 手动覆盖 API 地址(存 appState;传空串清除覆盖) */
export async function setApiBase(url: string): Promise<void> {
  await setAppState(API_BASE_STATE_KEY, url.trim())
  apiBaseCache = null
}

function normalizeBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`
}

/* =============== Token 会话(仅存本机,不进备份) =============== */

const AUTH_STORAGE_KEY = 'mygym.auth.v1'

interface StoredAuth {
  token: string
  user: User
}

export function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAuth
    return parsed?.token && parsed?.user?.id ? parsed : null
  } catch {
    return null
  }
}

export function storeAuth(auth: StoredAuth): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}

/* =============== 请求封装 =============== */

function authHeader(): Record<string, string> {
  const stored = loadStoredAuth()
  return stored?.token ? { Authorization: `Bearer ${stored.token}` } : {}
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const base = await getApiBase()
  if (!base) throw apiError('API_NOT_CONFIGURED', '未配置 MyGym API 服务器地址', 0)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init.headers ?? {}) },
      signal: controller.signal,
    })
    const text = await res.text()
    let body: unknown = undefined
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = undefined
      }
    }
    if (!res.ok) {
      const err = (body ?? {}) as { error?: string; message?: string }
      throw apiError(err.error ?? `HTTP_${res.status}`, err.message ?? `请求失败(${res.status})`, res.status)
    }
    return body as T
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw apiError('TIMEOUT', '请求超时,请稍后重试', 0)
    }
    if (isApiError(e)) throw e
    throw apiError('NETWORK', '无法连接服务器,请检查网络或服务器地址', 0)
  } finally {
    clearTimeout(timer)
  }
}

function apiError(code: string, message: string, status: number): ApiError {
  const err = new Error(message) as ApiError
  err.code = code
  err.status = status
  return err
}

/* =============== 端点封装 =============== */

export interface AuthResponse {
  token: string
  user: User
}

export const api = {
  /** 连通性探测(无需登录) */
  health(timeoutMs = 4000): Promise<{ ok: boolean; service: string; version: string }> {
    return request('/health', {}, timeoutMs)
  },

  /* ---- 认证(开发阶段为 mock/dev 登录,生产认证由服务端另行提供) ---- */
  devLogin(nickname: string): Promise<AuthResponse> {
    return request('/auth/dev-login', { method: 'POST', body: JSON.stringify({ nickname }) })
  },
  register(username: string, password: string, nickname: string): Promise<AuthResponse> {
    return request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, nickname }) })
  },
  login(username: string, password: string): Promise<AuthResponse> {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  },
  logout(): Promise<{ ok: boolean }> {
    return request('/auth/logout', { method: 'POST' })
  },
  me(): Promise<{ user: User }> {
    return request('/auth/me')
  },

  /* ---- 数据同步 ---- */
  exportData(): Promise<BackupFile> {
    return request('/data/export', {}, 60000)
  },
  importData(backup: BackupFile): Promise<ImportResponse> {
    return request('/data/import', { method: 'POST', body: JSON.stringify(backup) }, 120000)
  },

  /* ---- AI(后端代理:验证身份 → 限额 → 服务端持有 Key 调用 Provider) ---- */
  aiQuota(): Promise<AIQuotaResponse> {
    return request('/ai/quota')
  },
  aiTrainingSummary(payload: AITrainingSummaryRequest, timeoutMs = 65000): Promise<AITrainingSummaryResponse> {
    return request('/ai/training-summary', { method: 'POST', body: JSON.stringify(payload) }, timeoutMs)
  },
}

export interface ImportResponse {
  imported: Record<string, number>
  skippedForeign: number
  skippedInvalid: number
  conflicts: number
}

export interface AIQuotaResponse {
  enabled: boolean
  daily: { used: number; limit: number; remaining: number }
  monthly: { used: number; limit: number; remaining: number }
}

export interface AITrainingSummaryRequest {
  kind: 'month' | 'year'
  /** '2026-09'(月)/ '2026'(年) */
  period: string
  /** 结构化统计摘要(由客户端按确定性算法生成,不含原始明细) */
  stats: Record<string, unknown>
}

export interface AITrainingSummaryResponse {
  content: string
  model?: string
  cached?: boolean
  quota: AIQuotaResponse
}
