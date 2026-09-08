'use strict'

const http = require('../utils/http.js')
const session = require('../utils/session.js')
const env = require('../config/env.js')

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

/** 仅开发者工具/体验版可用的本地联调登录(后端必须未关闭 DEV_AUTH_ENABLED)。 */
async function devLogin(nickname) {
  const auth = await http.request({
    path: '/auth/dev-login',
    method: 'POST',
    data: { nickname: nickname || '小程序联调用户' },
    auth: false,
    loading: true,
    loadingText: '联调登录中'
  })
  session.saveAuth(auth)
  return auth
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
  devLogin,
  isLoggedIn,
  currentUser,
  getMe,
  logout,
  canUseDevLogin: env.isDevToolsSession
}
