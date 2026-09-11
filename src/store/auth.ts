import { create } from 'zustand'
import { setActiveUser, setAppState } from '@/db/db'
import type { User } from '@/db/models'
import { api, clearStoredAuth, isApiError, loadStoredAuth, storeAuth, type StoredAuth } from '@/services/api'

/**
 * 认证状态：Web V1 使用用户名 / 密码；前端只面向「拿到 token + User」的统一契约，
 * 后续增加微信、邮箱或手机号认证时无需改变业务数据层。
 *
 * dbEpoch:用户切换会导致本地数据库实例切换,App 树以它为 key 重挂载,
 * 让所有 useLiveQuery 订阅迁移到新的 Dexie 实例。
 */

export type AuthStatus = 'unknown' | 'loggedOut' | 'loggedIn'

interface AuthStore {
  user: User | null
  status: AuthStatus
  dbEpoch: number
  hydrate: () => Promise<void>
  register: (username: string, password: string, nickname: string) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  handleExternalAuthChange: (next: StoredAuth | null) => void
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  status: 'unknown',
  dbEpoch: 0,

  hydrate: async () => {
    const stored = loadStoredAuth()
    if (!stored) {
      set({ status: 'loggedOut', user: null })
      return
    }
    try {
      const { user } = await api.me()
      // hydrate 期间其他标签已切换/退出账号，不得恢复旧账号的内存和数据库上下文。
      if (loadStoredAuth()?.token !== stored.token) {
        setActiveUser(null)
        set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
        return
      }
      if (user.id !== stored.user.id) {
        // 服务端用户信息与本地缓存不一致,以服务端为准
        storeAuth({ token: stored.token, user })
      }
      setActiveUser(user.id)
      await setAppState('nickname', user.nickname)
      set({ user, status: 'loggedIn', dbEpoch: 1 })
    } catch (e) {
      if (loadStoredAuth()?.token !== stored.token) {
        setActiveUser(null)
        set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
        return
      }
      if (isApiError(e, 'UNAUTHORIZED') || (isApiError(e) && e.status === 401)) {
        // token 失效:清除会话回到未登录
        clearStoredAuth()
        setActiveUser(null)
        set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
        return
      }
      // 服务器不可达:保留登录态(离线可用),按本地缓存用户继续
      setActiveUser(stored.user.id)
      set({ user: stored.user, status: 'loggedIn', dbEpoch: 1 })
    }
  },

  register: async (username, password, nickname) => {
    const res = await api.register(username.trim(), password, nickname.trim())
    storeAuth(res)
    setActiveUser(res.user.id)
    await setAppState('nickname', res.user.nickname)
    set({ user: res.user, status: 'loggedIn', dbEpoch: Date.now() })
  },

  login: async (username, password) => {
    const res = await api.login(username.trim(), password)
    storeAuth(res)
    setActiveUser(res.user.id)
    await setAppState('nickname', res.user.nickname)
    set({ user: res.user, status: 'loggedIn', dbEpoch: Date.now() })
  },

  logout: () => {
    const auth = loadStoredAuth()
    void api.logout(auth).catch(() => undefined)
    clearStoredAuth()
    setActiveUser(null)
    set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
  },

  handleExternalAuthChange: (next) => {
    const current = useAuth.getState().user
    if (!current || (next && next.user.id === current.id)) return
    // 其他标签登录、退出或切换账号：本标签只做安全登出，不自动接管另一个账号。
    setActiveUser(null)
    set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
  },
}))

/** 仅 storage 事件会从“其他标签”触发；当前标签的登录/退出由 store 自己处理。 */
export function subscribeAuthStorageSync(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || event.key !== 'mygym.auth.v1') return
    let next: StoredAuth | null = null
    try {
      const parsed = event.newValue ? JSON.parse(event.newValue) as StoredAuth : null
      if (parsed?.token && parsed?.user?.id) next = parsed
    } catch {
      next = null
    }
    useAuth.getState().handleExternalAuthChange(next)
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
