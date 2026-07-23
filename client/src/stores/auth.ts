import { ref } from 'vue'

// 登录态（简单 reactive 模块）；登录成功后记录用户名
const username = ref<string | null>(localStorage.getItem('username'))

export function useAuth() {
  return {
    username,
    setLoggedIn(name: string) {
      username.value = name
      localStorage.setItem('username', name)
    },
    logout() {
      username.value = null
      localStorage.removeItem('username')
    },
  }
}
