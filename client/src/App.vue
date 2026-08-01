<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import LoadingOverlay from './components/LoadingOverlay.vue'
import AppFooter from './components/AppFooter.vue'
import AshParticles from './components/AshParticles.vue'
import { useLoading, LOADING_COVER_MS } from './stores/loading'

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
import './styles/blog_detail.css'
import './styles/login.css'

const route = useRoute()
const loading = useLoading()

// 首屏也播放四色块入场动画：等入场走完再揭示，节奏与路由切换的遮罩一致
onMounted(() => setTimeout(() => loading.reveal(), LOADING_COVER_MS))
</script>

<template>
  <LoadingOverlay />
  <AshParticles v-if="route.path === '/'" />
  <RouterView />
  <AppFooter />
</template>
