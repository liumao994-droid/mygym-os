'use strict'

const AUTH_STORAGE_KEY = 'mygym.auth.v1'

function getStoredAuth() {
  try {
    const raw = wx.getStorageSync(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && parsed.token && parsed.user && parsed.user.id ? parsed : null
  } catch (e) {
    return null
  }
}

function saveAuth(auth) {
  wx.setStorageSync(AUTH_STORAGE_KEY, auth)
  const app = typeof getApp === 'function' ? getApp() : null
  if (app) app.globalData.user = auth.user || null
}

function clearAuth() {
  wx.removeStorageSync(AUTH_STORAGE_KEY)
  const app = typeof getApp === 'function' ? getApp() : null
  if (app) app.globalData.user = null
}

function getToken() {
  const auth = getStoredAuth()
  return auth ? auth.token : ''
}

function isLoggedIn() {
  return Boolean(getToken())
}

function isOnLoginPage() {
  try {
    const pages = getCurrentPages()
    const current = pages && pages.length ? pages[pages.length - 1] : null
    return Boolean(current && /pages\/login\/login/.test(current.route || ''))
  } catch (e) {
    return false
  }
}

/** 401/session 过期:清 token,并自动回到登录页(登录页自身不重复跳转)。 */
function handleUnauthorized() {
  clearAuth()
  if (!isOnLoginPage()) {
    wx.reLaunch({ url: '/pages/login/login' })
  }
}

module.exports = {
  AUTH_STORAGE_KEY,
  getStoredAuth,
  saveAuth,
  clearAuth,
  getToken,
  isLoggedIn,
  handleUnauthorized
}
