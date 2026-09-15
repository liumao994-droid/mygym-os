'use strict'

/**
 * Phase 2B 专用 wx 替身:
 * - wx.request 走真实 HTTP(指向隔离服务器),语义对齐 wx.request(GET 拼 query、JSON 解析、fail.errMsg);
 * - 其余 wx API 用受控 stub 并完整记录(toast/modal/导航/loading),供断言;
 * - 提供 Page/Component/App 装载器,可在 Node 中实例化真实页面代码并驱动其生命周期。
 */

const path = require('node:path')

const MINIPROGRAM_ROOT = path.resolve(__dirname, '..', '..')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** 支持 'form.date'、'items[0].draftWeight'、'bodyParts[3].selected' 等小程序 setData 路径 */
function parseDataPath(p) {
  const segs = []
  for (const part of String(p).split('.')) {
    const head = part.match(/^([^\[\]]*)/)
    if (head && head[1]) segs.push(head[1])
    const bracket = /\[(\d+)\]/g
    let m
    while ((m = bracket.exec(part))) segs.push(Number(m[1]))
  }
  return segs
}

function setByPath(target, dotted, value) {
  const segs = parseDataPath(dotted)
  let node = target
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i]
    const nextKey = segs[i + 1]
    if (node[key] === undefined || node[key] === null) {
      node[key] = typeof nextKey === 'number' ? [] : {}
    }
    node = node[key]
  }
  node[segs[segs.length - 1]] = value
}

class RealWx {
  constructor(base) {
    this.base = base || 'http://127.0.0.1:9'
    this.storage = new Map()
    this.requests = []
    this.toasts = []
    this.modals = []
    this.navigations = []
    this.loadings = []
    this.titles = []
    this.failNext = 0
    this.delayNext = 0
    this.pages = []
    this.tabBar = {
      selected: '',
      setData(patch) { Object.assign(this, patch) }
    }
  }

  install() {
    global.wx = this
    global.getApp = () => ({ globalData: {} })
    global.getCurrentPages = () => this.pages
    global.App = (cfg) => { this.appConfig = cfg }
    global.Page = (cfg) => { this._capturedPage = cfg }
    global.Component = (cfg) => { this._capturedComponent = cfg }
    global.Behavior = (cfg) => cfg
    return this
  }

  /* ---------------- storage ---------------- */

  getStorageSync(key) {
    return this.storage.has(key) ? this.storage.get(key) : ''
  }

  setStorageSync(key, value) {
    this.storage.set(key, value)
  }

  removeStorageSync(key) {
    this.storage.delete(key)
  }

  /* ---------------- 记录型 stub ---------------- */

  showToast(opts) { this.toasts.push(opts || {}) }
  hideToast() {}
  showLoading(opts) { this.loadings.push({ show: opts || {} }) }
  hideLoading() { this.loadings.push({ hide: true }) }
  stopPullDownRefresh() {}
  setNavigationBarTitle(opts) { this.titles.push(opts && opts.title) }
  vibrateShort() {}

  showModal(opts) {
    this.modals.push(opts || {})
    if (opts && typeof opts.success === 'function') {
      opts.success({ confirm: true, cancel: false })
      return
    }
    return Promise.resolve({ confirm: true, cancel: false })
  }

  navigateTo(opts) { this.navigations.push({ type: 'navigateTo', url: opts && opts.url }) }
  redirectTo(opts) { this.navigations.push({ type: 'redirectTo', url: opts && opts.url }) }
  reLaunch(opts) { this.navigations.push({ type: 'reLaunch', url: opts && opts.url }) }
  switchTab(opts) { this.navigations.push({ type: 'switchTab', url: opts && opts.url }) }
  navigateBack(opts) { this.navigations.push({ type: 'navigateBack', url: '' }) }

  getAccountInfoSync() {
    return { miniProgram: { envVersion: 'develop' } }
  }

  getDeviceInfo() {
    return { platform: 'devtools' }
  }

  login(opts) {
    if (opts && opts.success) opts.success({ code: 'phase2b-wx-code' })
  }

  /* ---------------- 真实 HTTP request ---------------- */

  _finishFail(opts, errMsg) {
    if (opts && typeof opts.fail === 'function') opts.fail({ errMsg })
    if (opts && typeof opts.complete === 'function') opts.complete()
  }

  request(opts) {
    this.requests.push({
      method: String((opts && opts.method) || 'GET').toUpperCase(),
      url: opts.url,
      data: opts.data,
      header: opts.header,
      at: Date.now()
    })
    const run = async () => {
      if (this.failNext > 0) {
        this.failNext -= 1
        this._finishFail(opts, 'request:fail -2:net::ERR_CONNECTION_REFUSED')
        return
      }
      if (this.delayNext > 0) {
        const d = this.delayNext
        this.delayNext = 0
        await sleep(d)
      }
      try {
        const method = String((opts && opts.method) || 'GET').toUpperCase()
        let url = opts.url
        if (method === 'GET' && opts.data && typeof opts.data === 'object') {
          const qs = new URLSearchParams()
          for (const [k, v] of Object.entries(opts.data)) {
            if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
          }
          const q = qs.toString()
          if (q) url += (url.includes('?') ? '&' : '?') + q
        }
        const res = await fetch(url, {
          method,
          headers: opts.header,
          body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(opts.data ?? {}),
          signal: AbortSignal.timeout(opts.timeout || 15000)
        })
        const text = await res.text()
        let data = null
        try { data = text ? JSON.parse(text) : null } catch (e) { data = text }
        if (typeof opts.success === 'function') opts.success({ statusCode: res.status, data })
      } catch (e) {
        const timeout = e && e.name === 'AbortError'
        this._finishFail(opts, timeout ? 'request:fail timeout' : `request:fail ${String((e && e.message) || e)}`)
        return
      }
      if (typeof opts.complete === 'function') opts.complete()
    }
    run()
  }

  /* ---------------- 断言辅助 ---------------- */

  requestsTo(suffix) {
    return this.requests.filter((r) => r.url.endsWith(suffix))
  }

  lastToast() {
    return this.toasts.length ? this.toasts[this.toasts.length - 1] : null
  }
}

/* ---------------- 页面装载器 ---------------- */

const pageConfigCache = new Map()
const componentConfigCache = new Map()

function requirePageConfig(absPath) {
  if (pageConfigCache.has(absPath)) return pageConfigCache.get(absPath)
  let cfg = null
  const prev = global.Page
  global.Page = (c) => { cfg = c }
  try {
    require(absPath)
  } finally {
    global.Page = prev
  }
  if (!cfg) throw new Error(`页面未调用 Page(): ${absPath}`)
  pageConfigCache.set(absPath, cfg)
  return cfg
}

function requireComponentConfig(absPath) {
  if (componentConfigCache.has(absPath)) return componentConfigCache.get(absPath)
  let cfg = null
  const prev = global.Component
  global.Component = (c) => { cfg = c }
  try {
    require(absPath)
  } finally {
    global.Component = prev
  }
  componentConfigCache.set(absPath, cfg)
  return cfg
}

function instantiate(cfg, wx) {
  const inst = Object.create(cfg)
  inst.data = deepClone(cfg.data)
  inst.setData = (patch, cb) => {
    for (const [k, v] of Object.entries(patch || {})) setByPath(inst.data, k, v)
    if (typeof cb === 'function') cb()
  }
  inst.getTabBar = () => wx.tabBar
  return inst
}

function pageInstance(wx, relPath) {
  const abs = path.resolve(MINIPROGRAM_ROOT, relPath)
  return instantiate(requirePageConfig(abs), wx)
}

function componentInstance(wx, relPath) {
  const abs = path.resolve(MINIPROGRAM_ROOT, relPath)
  const cfg = requireComponentConfig(abs)
  const inst = instantiate({ data: cfg.data || {}, ...cfg }, wx)
  return inst
}

async function waitUntil(fn, { timeout = 8000, interval = 20, what = '' } = {}) {
  const start = Date.now()
  for (;;) {
    let value
    try {
      value = await fn()
    } catch (e) {
      value = false
    }
    if (value) return value
    if (Date.now() - start > timeout) {
      throw new Error(`waitUntil 超时(${what || 'unknown'}): ${timeout}ms`)
    }
    await sleep(interval)
  }
}

module.exports = {
  RealWx,
  pageInstance,
  componentInstance,
  waitUntil,
  sleep,
  MINIPROGRAM_ROOT
}
