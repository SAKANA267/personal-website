<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useLocale } from '../stores/locale'

const router = useRouter()
const { t, apiError } = useLocale()
const username = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

async function submit() {
  error.value = ''
  pending.value = true
  try {
    const res = await api.signup({ username: username.value, password: password.value })
    if (res.ok) {
      router.push('/login')
    } else {
      error.value = apiError(res.data, 'signup.fail')
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
        <h1>{{ t('signup.title') }}</h1>
        <WriterByline />
      </header>

      <form class="auth-form" @submit.prevent="submit">
        <div class="field">
          <label for="username">{{ t('signup.username') }}</label>
          <input type="text" id="username" v-model="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">{{ t('signup.password') }}</label>
          <input type="password" id="password" v-model="password" autocomplete="new-password" required minlength="6" />
          <p class="field-hint">{{ t('signup.hint') }}</p>
        </div>
        <button type="submit" class="auth-submit" :disabled="pending">
          {{ pending ? t('signup.pending') : t('signup.submit') }}
        </button>
        <p v-if="error" class="auth-error">{{ error }}</p>
      </form>

      <p class="auth-alt">{{ t('signup.altText') }} <router-link to="/login">{{ t('signup.altLink') }}</router-link></p>
    </div>
  </div>
</template>
