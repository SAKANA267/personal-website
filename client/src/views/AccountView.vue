<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'

const router = useRouter()
const { username, logout } = useAuth()
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const notice = ref('')
const pending = ref(false)

async function submit() {
  error.value = ''
  notice.value = ''
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  pending.value = true
  try {
    const res = await api.changePassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    if (res.ok) {
      notice.value = '密码已更新'
      oldPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    } else {
      error.value = res.data?.error || 'Password change failed'
    }
  } finally {
    pending.value = false
  }
}

async function onLogout() {
  await logout()
  router.push('/')
}
</script>

<template>
  <div class="page-auth">

    <div class="container auth-container">
      <header class="auth-header">
        <h1>Account</h1>
        <WriterByline />
      </header>

      <!-- 身份条：当前用户与退出同属一组，上下发丝线围合 -->
      <div class="auth-session">
        <span class="auth-session-label">Signed in as</span>
        <span class="auth-session-name">{{ username }}</span>
        <button type="button" class="auth-session-out" @click="onLogout">退出登录</button>
      </div>

      <p class="auth-section-label">Change Password</p>

      <form class="auth-form" @submit.prevent="submit">
        <div class="field">
          <label for="old-password">Old password</label>
          <input type="password" id="old-password" v-model="oldPassword" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="new-password">New password</label>
          <input type="password" id="new-password" v-model="newPassword" autocomplete="new-password" required minlength="6" />
          <p class="field-hint">At least 6 characters</p>
        </div>
        <div class="field">
          <label for="confirm-password">Confirm new password</label>
          <input type="password" id="confirm-password" v-model="confirmPassword" autocomplete="new-password" required minlength="6" />
        </div>
        <button type="submit" class="auth-submit" :disabled="pending">
          {{ pending ? 'Saving…' : 'Change Password' }}
        </button>
        <p v-if="error" class="auth-error">{{ error }}</p>
        <p v-if="notice" class="auth-notice">{{ notice }}</p>
      </form>
    </div>
  </div>
</template>
