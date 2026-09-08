'use strict'

const ITEMS = [
  { key: 'home', label: '首页', icon: '⌂', url: '/pages/home/home' },
  { key: 'strength', label: '训练', icon: '力', url: '/pages/strength/strength' },
  { key: 'history', label: '历史', icon: '↶', url: '/pages/history/history' },
  { key: 'me', label: '我的', icon: '人', url: '/pages/me/me' }
]

Component({
  properties: {
    selected: { type: String, value: '' }
  },
  data: { items: ITEMS },
  methods: {
    onSelect(e) {
      const item = ITEMS.find((x) => x.key === e.currentTarget.dataset.key)
      if (!item || item.key === this.properties.selected) return
      wx.reLaunch({ url: item.url })
    }
  }
})
