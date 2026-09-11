import { create } from 'zustand'
import { setActiveUser, setAppState } from '@/db/db'
import type { User } from '@/db/models'
import { api, clearStoredAuth, isApiError, loadStoredAuth, storeAuth } from '@/services/api'

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
      if (user.id !== stored.user.id) {
        // 服务端用户信息与本地缓存不一致,以服务端为准
        storeAuth({ token: stored.token, user })
      }
      setActiveUser(user.id)
      await setAppState('nickname', user.nickname)
      set({ user, status: 'loggedIn', dbEpoch: 1 })
    } catch (e) {
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
    void api.logout().catch(() => undefined)
    clearStoredAuth()
    setActiveUser(null)
    set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
  },
}))
