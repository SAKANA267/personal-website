import { ref } from 'vue'
import { api } from '../composables/useApi'

// 登录态（简单 reactive 模块，无 Pinia——项目约定）。
// 双层存储：localStorage 作首屏缓存避免闪烁，服务端 session cookie 是唯一事实源，
// 应用启动时 initAuth() 用 /api/auth/me 校验同步，401 即清除本地缓存。
// isAdmin 来自服务端（ADMIN_USERNAMES 白名单），驱动 devlog 写入/留言审核等管理界面。
const username = ref<string | null>(localStorage.getItem('username'))
const isAdmin = ref(false)
// 是否已完成一次服务器校验（供需要等登录态确定的逻辑使用）
const restored = ref(false)

function clearLocal() {
  username.value = null
  isAdmin.value = false
  localStorage.removeItem('username')
}

export function useAuth() {
  return {
    username,
    isAdmin,
    restored,
    setLoggedIn(name: string, admin = false) {
      username.value = name
      isAdmin.value = admin
      localStorage.setItem('username', name)
    },
    // 启动时与服务端会话对账：登录但本地无缓存 → 恢复；本地有缓存但会话已失效 → 清除
    async initAuth() {
      try {
        const res = await api.me()
        if (res.ok && res.data?.username) {
          if (username.value !== res.data.username || isAdmin.value !== !!res.data.isAdmin) {
            username.value = res.data.username
            isAdmin.value = !!res.data.isAdmin
            localStorage.setItem('username', res.data.username)
          }
        } else if (res.status === 401) {
          clearLocal()
        }
        // 其余状态码/网络异常：保留本地缓存，下次启动再对账
      } catch {
        // 网络异常时保留本地缓存
      }
      restored.value = true
    },
    async logout() {
      try {
        await api.logout()
      } catch {
        // 接口失败也照常清理本地态，避免卡在"已登录"
      }
      clearLocal()
    },
  }
}
