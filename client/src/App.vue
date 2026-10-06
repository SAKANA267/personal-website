<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import './styles/title_card.css' // 标题卡英雄区样式
import './styles/charts_lab.css' // 图表实验室测试页样式

const route = useRoute()
const loading = useLoading()

// 标题卡在场期间隐藏 footer / 粒子，避免撑出滚动条破坏首屏封面
// 首会话标题卡显示时 titleCardSeen 未标记；HomeView enter 后 dispatch 'titlecard:reveal'
const TITLE_CARD_FLAG = 'titleCardSeen'
const titleCardRevealed = ref(
  typeof sessionStorage !== 'undefined' && !!sessionStorage.getItem(TITLE_CARD_FLAG)
)
if (typeof window !== 'undefined') {
  window.addEventListener('titlecard:reveal', () => {
    titleCardRevealed.value = true
  })
}
const showFooter = computed(() => (route.path === '/' ? titleCardRevealed.value : true))

// 首屏也播放四色块入场动画：等入场走完再揭示，节奏与路由切换的遮罩一致
// 例外：会话首次进入时标题卡在首页内首屏展示——store 初始化已置 hidden，跳过遮罩
onMounted(() => {
  if (loading.hidden.value) {
    // 标题卡首屏：store 已置 hidden=true，直接揭示（实际无遮罩渲染）
    loading.reveal()
    return
  }
  setTimeout(() => loading.reveal(), LOADING_COVER_MS)
})
</script>

<template>
  <LoadingOverlay />
  <AshParticles v-if="route.path === '/' && titleCardRevealed" />
  <RouterView />
  <AppFooter v-if="showFooter" />
</template>
