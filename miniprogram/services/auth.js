'use strict'

const http = require('../utils/http.js')
const session = require('../utils/session.js')

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res && res.code) resolve(res.code)
        else reject(Object.assign(new Error('微信登录未返回 code'), { type: 'WECHAT', code: 'WECHAT_LOGIN_FAILED' }))
      },
      fail(err) {
        reject(Object.assign(new Error(err && err.errMsg || '微信登录失败'), { type: 'WECHAT', code: 'WECHAT_LOGIN_FAILED' }))
      }
    })
  })
}

/**
 * 正式链路:wx.login 临时 code → 后端 code2session → 后端返回统一 JWT。
 * 小程序端永远不接触 AppSecret/openid。
 */
async function wechatLogin() {
  const code = await wxLoginCode()
  const auth = await http.request({
    path: '/auth/wechat',
    method: 'POST',
    data: { code },
    auth: false,
    loading: true,
    loadingText: '微信登录中'
  })
  session.saveAuth(auth)
  return auth
}

async function accountLogin(username, password) {
  const auth = await http.request({
    path: '/auth/login',
    method: 'POST',
    data: { username, password },
    auth: false,
    loading: true,
    loadingText: '登录中'
  })
  session.saveAuth(auth)
  return auth
}

async function register(username, password, nickname) {
  const result = await http.request({
    path: '/auth/register',
    method: 'POST',
    data: { username, password, nickname },
    auth: false,
    loading: true,
    loadingText: '注册中'
  })
  session.saveAuth(result)
  return result
}

/**
 * 把当前微信 openid 绑定到已登录账号(幂等,失败静默)。
 * 绑定后 /auth/wechat 会直接返回该账号;服务端未配置微信时跳过。
 */
async function bindWechatToCurrentUser() {
  try {
    const code = await wxLoginCode()
    return await http.request({
      path: '/auth/wechat/bind',
      method: 'POST',
      data: { code },
      loading: false
    })
  } catch (e) {
    if (e && e.code === 'WECHAT_NOT_CONFIGURED') return null
    return { linked: false, migrated: false, error: e }
  }
}

function isLoggedIn() {
  return session.isLoggedIn()
}

function currentUser() {
  const auth = session.getStoredAuth()
  return auth ? auth.user : null
}

async function getMe() {
  const body = await http.request({ path: '/auth/me' })
  return body.user
}

async function getProfile() {
  const body = await http.request({ path: '/auth/profile' })
  return body.profile
}

async function updateProfile(profile) {
  const body = await http.request({ path: '/auth/profile', method: 'PATCH', data: profile, loading: true, loadingText: '保存中' })
  const stored = session.getStoredAuth()
  if (stored && stored.user) session.saveAuth(Object.assign({}, stored, { user: Object.assign({}, stored.user, { nickname: body.profile.nickname, avatar: body.profile.avatar }) }))
  return body.profile
}

async function logout() {
  try {
    await http.request({ path: '/auth/logout', method: 'POST', skipAuthRedirect: true })
  } catch (e) {
    // 服务端登出本身无状态,本地清 token 仍是安全的
  }
  session.clearAuth()
}

module.exports = {
  wechatLogin,
  accountLogin,
  register,
  bindWechatToCurrentUser,
  isLoggedIn,
  currentUser,
  getMe,
  getProfile,
  updateProfile,
  logout
}
