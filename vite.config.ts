import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'MyGym OS',
        short_name: 'MyGym',
        description: '私人健身训练记录、力量成长与训练分析系统',
        theme_color: '#081331',
        background_color: '#081331',
        display: 'standalone',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  /* 本地预览服务器放行隧道域名,便于公网演示;
     真实部署为纯静态托管,无此限制 */
  preview: {
    allowedHosts: true,
  },
})
