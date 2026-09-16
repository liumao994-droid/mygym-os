'use strict'

Page({
  data: {
    type: 'privacy',
    title: '隐私政策'
  },

  onLoad(options) {
    const type = options && options.type === 'terms' ? 'terms' : 'privacy'
    const title = type === 'terms' ? '用户协议' : '隐私政策'
    this.setData({ type, title })
    wx.setNavigationBarTitle({ title })
  }
})
