<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'

const router = useRouter()
const { setLoggedIn } = useAuth()
const username = ref('')
const password = ref('')

async function submit() {
  const res = await api.login({ username: username.value, password: password.value })
  if (res.ok) {
    setLoggedIn(username.value)
    router.push('/')
  } else {
    alert('Invalid username or password')
  }
}
</script>

<template>
  <div class="page-auth">
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }, { label: 'Blog', to: '/blog' }]" />

    <div class="container">
      <h1>Login</h1>
      <WriterByline />

      <form @submit.prevent="submit">
        <label for="username">Username:</label>
        <input type="text" id="username" v-model="username" required /><br /><br />
        <label for="password">Password:</label>
        <input type="password" id="password" v-model="password" required /><br /><br />
        <input type="submit" value="Login" />
        <p>Don't have an account? <router-link to="/signup">Sign up here</router-link></p>
      </form>
    </div>
  </div>
</template>
