<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'

const router = useRouter()
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
      error.value = res.data?.error || 'Sign up failed'
    }
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="page-auth">
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }, { label: 'Blog', to: '/blog' }]" />

    <div class="container auth-container">
      <header class="auth-header">
        <h1>Sign Up</h1>
        <WriterByline />
      </header>

      <form class="auth-form" @submit.prevent="submit">
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" v-model="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" v-model="password" autocomplete="new-password" required minlength="6" />
          <p class="field-hint">At least 6 characters</p>
        </div>
        <button type="submit" class="auth-submit" :disabled="pending">
          {{ pending ? 'Signing up…' : 'Sign Up' }}
        </button>
        <p v-if="error" class="auth-error">{{ error }}</p>
      </form>

      <p class="auth-alt">Already have an account? <router-link to="/login">Login here</router-link></p>
    </div>
  </div>
</template>
