<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'

const router = useRouter()
const { t, apiError } = useLocale()
const { username, logout, isAdmin } = useAuth()
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const notice = ref('')
const pending = ref(false)

// 管理员工具：重置任意用户密码（找回密码的最小闭环，无邮件设施时线下核实身份后使用）
const resetTarget = ref('')
const resetPassword = ref('')
const resetConfirm = ref('')
const resetError = ref('')
const resetNotice = ref('')
const resetPending = ref(false)

async function submitReset() {
  resetError.value = ''
  resetNotice.value = ''
  if (resetPassword.value !== resetConfirm.value) {
    resetError.value = t('accountPage.mismatch')
    return
  }
  resetPending.value = true
  try {
    const res = await api.adminResetPassword({
      username: resetTarget.value,
      newPassword: resetPassword.value,
    })
    if (res.ok) {
      resetNotice.value = t('accountPage.adminDone', { name: resetTarget.value })
      resetTarget.value = ''
      resetPassword.value = ''
      resetConfirm.value = ''
    } else {
      resetError.value = apiError(res.data, 'accountPage.adminFail')
    }
  } finally {
    resetPending.value = false
  }
}

async function submit() {
  error.value = ''
  notice.value = ''
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('accountPage.mismatch')
    return
  }
  pending.value = true
  try {
    const res = await api.changePassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    if (res.ok) {
      notice.value = t('accountPage.updated')
      oldPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    } else {
      error.value = apiError(res.data, 'accountPage.fail')
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
        <h1>{{ t('accountPage.title') }}</h1>
        <WriterByline />
      </header>

      <!-- 身份条：当前用户与退出同属一组，上下发丝线围合 -->
      <div class="auth-session">
        <span class="auth-session-label">{{ t('account.signedInAs') }}</span>
        <span class="auth-session-name">{{ username }}</span>
        <button type="button" class="auth-session-out" @click="onLogout">{{ t('account.logout') }}</button>
      </div>

      <p class="auth-section-label">{{ t('accountPage.section') }}</p>

      <form class="auth-form" @submit.prevent="submit">
        <div class="field">
          <label for="old-password">{{ t('accountPage.oldPassword') }}</label>
          <input type="password" id="old-password" v-model="oldPassword" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="new-password">{{ t('accountPage.newPassword') }}</label>
          <input type="password" id="new-password" v-model="newPassword" autocomplete="new-password" required minlength="6" />
          <p class="field-hint">{{ t('accountPage.hint') }}</p>
        </div>
        <div class="field">
          <label for="confirm-password">{{ t('accountPage.confirmPassword') }}</label>
          <input type="password" id="confirm-password" v-model="confirmPassword" autocomplete="new-password" required minlength="6" />
        </div>
        <button type="submit" class="auth-submit" :disabled="pending">
          {{ pending ? t('accountPage.pending') : t('accountPage.submit') }}
        </button>
        <p v-if="error" class="auth-error">{{ error }}</p>
        <p v-if="notice" class="auth-notice">{{ notice }}</p>
      </form>

      <!-- 管理员工具：重置任意用户密码（仅 ADMIN_USERNAMES 白名单可见） -->
      <template v-if="isAdmin">
        <p class="auth-section-label">{{ t('accountPage.adminSection') }}</p>
        <form class="auth-form" @submit.prevent="submitReset">
          <div class="field">
            <label for="reset-target">{{ t('accountPage.adminTarget') }}</label>
            <input type="text" id="reset-target" v-model="resetTarget" maxlength="255" required />
          </div>
          <div class="field">
            <label for="reset-password">{{ t('accountPage.newPassword') }}</label>
            <input type="password" id="reset-password" v-model="resetPassword" autocomplete="new-password" required minlength="6" />
            <p class="field-hint">{{ t('accountPage.hint') }}</p>
          </div>
          <div class="field">
            <label for="reset-confirm">{{ t('accountPage.confirmPassword') }}</label>
            <input type="password" id="reset-confirm" v-model="resetConfirm" autocomplete="new-password" required minlength="6" />
          </div>
          <button type="submit" class="auth-submit" :disabled="resetPending">
            {{ resetPending ? t('accountPage.pending') : t('accountPage.adminSubmit') }}
          </button>
          <p v-if="resetError" class="auth-error">{{ resetError }}</p>
          <p v-if="resetNotice" class="auth-notice">{{ resetNotice }}</p>
        </form>
      </template>
    </div>
  </div>
</template>
