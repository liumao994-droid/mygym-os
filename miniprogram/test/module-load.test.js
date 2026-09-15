'use strict'

/**
 * 模块装载冒烟测试(Console Error 代理检查):
 * 以受控 shim 装载全部页面/组件/服务/工具/配置模块 —— 任何模块级
 * ReferenceError / SyntaxError / 顶层异常都会在这里暴露,对应真实运行时
 * "项目自身 Error" 的静态可复现子集。无需服务器,始终随 npm test 运行。
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { RealWx } = require('./helpers/real-wx.js')

const ROOT = path.resolve(__dirname, '..')
const wxh = new RealWx('http://127.0.0.1:9').install()

function listFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) listFiles(full, out)
    else if (full.endsWith('.js')) out.push(full)
  }
  return out
}

test('app.js 可装载且 onLaunch 可执行', () => {
  delete require.cache[path.join(ROOT, 'app.js')]
  require(path.join(ROOT, 'app.js'))
  const cfg = wxh.appConfig
  assert.ok(cfg, 'app.js 必须调用 App()')
  const app = Object.assign({ globalData: { user: null } }, cfg)
  app.onLaunch.call(app)
  assert.ok(app.globalData)
})

test('app.json 登记的全部页面可装载并实例化', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const pages = [...appJson.pages]
  assert.ok(pages.length >= 12, `应登记至少 12 个页面,实际 ${pages.length}`)
  for (const p of pages) {
    const inst = (() => {
      let cfg = null
      const prev = global.Page
      global.Page = (c) => { cfg = c }
      try {
        require(path.join(ROOT, `${p}.js`))
      } finally {
        global.Page = prev
      }
      return cfg
    })()
    assert.ok(inst, `${p} 必须调用 Page()`)
    assert.ok(inst.data && typeof inst.data === 'object', `${p} 必须声明 data`)
    const hasLifecycle = typeof inst.onLoad === 'function' || typeof inst.onShow === 'function'
    assert.ok(hasLifecycle, `${p} 生命周期缺失`)
  }
})

test('全部组件可装载', () => {
  const componentsDir = path.join(ROOT, 'components')
  const tabbar = path.join(ROOT, 'custom-tab-bar', 'index.js')
  const files = [...listFiles(componentsDir), tabbar]
  for (const file of files) {
    delete require.cache[file]
    let cfg = null
    const prev = global.Component
    global.Component = (c) => { cfg = c }
    try {
      require(file)
    } finally {
      global.Component = prev
    }
    assert.ok(cfg, `${path.relative(ROOT, file)} 必须调用 Component()`)
  }
})

test('services/utils/models/config 全部模块可装载', () => {
  for (const dir of ['services', 'utils', 'models', 'config']) {
    const full = path.join(ROOT, dir)
    if (!fs.existsSync(full)) continue
    for (const file of listFiles(full)) {
      delete require.cache[file]
      assert.doesNotThrow(() => require(file), `${path.relative(ROOT, file)} 装载失败`)
    }
  }
})
