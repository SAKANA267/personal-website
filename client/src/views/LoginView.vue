<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'

const router = useRouter()
const { username: loggedInAs, setLoggedIn } = useAuth()
const username = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

async function submit() {
  error.value = ''
  pending.value = true
  try {
    const res = await api.login({ username: username.value, password: password.value })
    if (res.ok) {
      // 以服务端返回的用户名/管理员标记为准（session 是事实源），兜底表单值
      setLoggedIn(res.data?.username || username.value, !!res.data?.isAdmin)
      router.push('/')
    } else {
      error.value = res.data?.error || 'Invalid username or password'
    }
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="page-auth">

    <div class="container auth-container">
      <header class="auth-header">
        <h1>Login</h1>
        <WriterByline />
      </header>

      <form class="auth-form" @submit.prevent="submit">
        <p v-if="loggedInAs" class="auth-status">当前已登录：{{ loggedInAs }}</p>
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" v-model="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" v-model="password" autocomplete="current-password" required />
        </div>
        <button type="submit" class="auth-submit" :disabled="pending">
          {{ pending ? 'Logging in…' : 'Login' }}
        </button>
        <p v-if="error" class="auth-error">{{ error }}</p>
      </form>

      <p class="auth-alt">Don't have an account? <router-link to="/signup">Sign up here</router-link></p>
    </div>
  </div>
</template>
