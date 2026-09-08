import { create } from 'zustand'
import { setActiveUser } from '@/db/db'
import type { User } from '@/db/models'
import { api, clearStoredAuth, isApiError, loadStoredAuth, storeAuth } from '@/services/api'

/**
 * 认证状态(开发阶段使用 dev 登录;生产环境由服务端提供微信等认证方式,
 * 前端只面向「拿到 token + User」这一统一契约,认证方式变化不影响业务层)。
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
  loginWithNickname: (nickname: string) => Promise<void>
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

  loginWithNickname: async (nickname) => {
    const name = nickname.trim()
    if (!name) throw new Error('请输入昵称')
    const res = await api.devLogin(name)
    storeAuth(res)
    setActiveUser(res.user.id)
    set({ user: res.user, status: 'loggedIn', dbEpoch: Date.now() })
  },

  logout: () => {
    clearStoredAuth()
    setActiveUser(null)
    set({ user: null, status: 'loggedOut', dbEpoch: Date.now() })
  },
}))
