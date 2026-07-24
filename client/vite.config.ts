import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 生产部署在子路径 /web/ 下（nginx 反代时去前缀转发给 Node）；
  // dev 也生效，本地访问地址变为 http://localhost:5173/web/
  base: '/web/',
  plugins: [vue()],
  server: {
    // dev：把 /api 代理到 Express 后端（默认 3000）
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
