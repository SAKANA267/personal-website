<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'

defineProps<{ items: { label: string; to: string }[] }>()

const router = useRouter()
const { username, logout } = useAuth()
// 点击触发客户端路由（路由守卫会复刻 loading.in 的 1 秒遮罩过渡）
function go(to: string) {
  router.push(to)
}
// 退出登录：清理登录态后留在当前页
async function onLogout() {
  await logout()
}
</script>

<template>
  <div class="topnav">
    <template v-for="item in items" :key="item.to">
      <!-- 登录项随登录态替换：已登录 → 用户名（点击进账号中心）+ 退出；未登录 → 原样 -->
      <template v-if="item.to === '/login' && username">
        <p class="btn" @click="go('/account')">{{ username }}</p>
        <p class="btn" @click="onLogout">退出</p>
      </template>
      <p v-else class="btn" @click="go(item.to)">{{ item.label }}</p>
    </template>
  </div>
</template>
