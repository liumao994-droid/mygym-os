'use strict'

const env = require('../../config/env.js')
const auth = require('../../services/auth.js')

Page({
  data: {
    apiBase: '',
    account: '',
    password: '',
    nickname: '小程序联调用户',
    canDevLogin: false,
    devOpen: false,
    busy: false
  },

  onLoad() {
    if (auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/home/home' })
      return
    }
    this.setData({
      apiBase: env.getApiBase(),
      canDevLogin: auth.canUseDevLogin()
    })
  },

  onBaseInput(e) {
    this.setData({ apiBase: e.detail.value })
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onToggleDev() {
    this.setData({ devOpen: !this.data.devOpen })
  },

  onSaveBase() {
    env.setApiBase(this.data.apiBase)
    this.setData({ apiBase: env.getApiBase() })
    wx.showToast({ title: 'API 地址已保存', icon: 'success' })
  },

  /**
   * 账号密码登录:与网页版共用同一个 local 账号,两端数据互通。
   * 登录后静默尝试微信绑定:下次「微信一键登录」直接回到本账号。
   * 绑定失败(未配置微信/已绑定其他账号)不影响本次登录。
   */
  async onAccountLogin() {
    if (this.data.busy) return
    const account = String(this.data.account || '').trim()
    const password = String(this.data.password || '')
    if (!account || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      await auth.accountLogin(account, password)
      const binding = await auth.bindWechatToCurrentUser()
      if (binding && binding.error) {
        wx.showToast({ title: '账号已登录，微信绑定未完成', icon: 'none' })
      } else if (binding && binding.migrated) {
        wx.showToast({ title: '旧微信训练已安全迁移', icon: 'success' })
      }
      wx.reLaunch({ url: '/pages/home/home' })
    } catch (e) {
      wx.showModal({ title: '登录失败', content: e.message || '请检查账号密码', showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onWechatLogin() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      await auth.wechatLogin()
      wx.reLaunch({ url: '/pages/home/home' })
    } catch (e) {
      const message =
        e.code === 'WECHAT_NOT_CONFIGURED'
          ? '后端尚未配置 WECHAT_APP_ID / WECHAT_APP_SECRET,可先使用下方账号密码登录'
          : e.code === 'WECHAT_CODE_INVALID'
            ? '登录凭证已失效,请重试'
            : e.message || '微信登录失败'
      wx.showModal({ title: '登录失败', content: message, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onDevLogin() {
    if (this.data.busy || !this.data.canDevLogin) return
    this.setData({ busy: true })
    try {
      await auth.devLogin(this.data.nickname)
      wx.reLaunch({ url: '/pages/home/home' })
    } catch (e) {
      wx.showModal({ title: '联调登录失败', content: e.message || '请确认后端开发登录已开启', showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  }
})
