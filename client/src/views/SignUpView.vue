<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'

const router = useRouter()
const username = ref('')
const password = ref('')

async function submit() {
  const res = await api.signup({ username: username.value, password: password.value })
  if (res.ok) {
    router.push('/login')
  } else {
    alert((res.data as any)?.error || 'Sign up failed')
  }
}
</script>

<template>
  <div class="page-auth">
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }]" />

    <div class="container">
      <h1>Sign Up</h1>
      <WriterByline />

      <form @submit.prevent="submit">
        <label for="username">Username:</label>
        <input type="text" id="username" v-model="username" required /><br /><br />
        <label for="password">Password:</label>
        <input type="password" id="password" v-model="password" required /><br /><br />
        <input type="submit" value="Sign Up" />
        <p>Already have an account? <router-link to="/login">Login here</router-link></p>
      </form>
    </div>
  </div>
</template>
