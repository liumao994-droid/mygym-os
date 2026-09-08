'use strict'

/** 可编程 wx 运行时替身,用于在 Node 中验证小程序服务层/API client。 */
class FakeWx {
  constructor() {
    this.storage = new Map()
    this.requestQueue = []
    this.requests = []
    this.loadingStack = []
    this.relaunchUrl = null
    this.loginResult = { code: 'test-wx-code' }
  }

  install() {
    global.wx = this
    global.getApp = () => ({ globalData: {} })
    return this
  }

  getStorageSync(key) {
    return this.storage.has(key) ? this.storage.get(key) : ''
  }

  setStorageSync(key, value) {
    this.storage.set(key, value)
  }

  removeStorageSync(key) {
    this.storage.delete(key)
  }

  showLoading(opts) {
    this.loadingStack.push({ show: opts || {} })
  }

  hideLoading() {
    this.loadingStack.push({ hide: true })
  }

  getAccountInfoSync() {
    return { miniProgram: { envVersion: 'develop' } }
  }

  getCurrentPages() {
    return [{ route: 'pages/home/home' }]
  }

  reLaunch(opts) {
    this.relaunchUrl = opts.url
  }

  navigateTo(opts) {
    this.navigateUrl = opts.url
  }

  showToast() {}

  showModal(opts) {
    if (opts && opts.success) opts.success({ confirm: true })
  }

  login(opts) {
    if (opts && opts.success) opts.success({ code: this.loginResult.code })
  }

  enqueue(spec) {
    this.requestQueue.push(spec)
  }

  request(opts) {
    this.requests.push(opts)
    const spec = this.requestQueue.shift()
    if (!spec) throw new Error('FakeWx: 没有预设的 wx.request 响应')
    if (spec.error) {
      if (opts.fail) opts.fail({ errMsg: spec.error })
    } else {
      if (opts.success) opts.success({ statusCode: spec.statusCode || 200, data: spec.data })
    }
    if (opts.complete) opts.complete()
  }
}

function freshWx() {
  return new FakeWx().install()
}

module.exports = {
  FakeWx,
  freshWx
}
