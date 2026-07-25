<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import LoadingOverlay from './components/LoadingOverlay.vue'
import AppFooter from './components/AppFooter.vue'
import AshParticles from './components/AshParticles.vue'
import { useLoading } from './stores/loading'

// 导入设计系统
import './styles/design-system.css'
import './styles/loading_animation.css'
import './styles/global.css'
import './styles/ash_animation.css'
import './styles/home.css'
import './styles/contact.css'
import './styles/chat.css'
import './styles/question_bank.css'
import './styles/dev_log.css'
import './styles/blog.css'
import './styles/login.css'

const route = useRoute()
const loading = useLoading()

// 初次挂载后揭示遮罩（对应原 window.load → loading.out()）
onMounted(() => loading.reveal())
</script>

<template>
  <LoadingOverlay />
  <AshParticles v-if="route.path === '/'" />
  <RouterView />
  <AppFooter />
</template>
