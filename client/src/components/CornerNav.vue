<script setup lang="ts">
import { useRouter } from 'vue-router'
import AccountMenu from './AccountMenu.vue'

// 全站角落导航（App 级，替代各页 TopNav 的文字导航行）：
// 左上角「返回主页」icon（首页自身不显示）+ 右上角账号入口（AccountMenu）。
// 挂在 RouterView 之外渲染，fixed 定位不受各页入场动画 transform 的包含块影响。
defineProps<{ showHome: boolean; showAccount: boolean }>()

const router = useRouter()
</script>

<template>
  <button
    v-if="showHome"
    type="button"
    class="corner-nav-home"
    aria-label="返回主页"
    title="返回主页"
    @click="router.push('/')"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4.25 10.75L12 4.25l7.75 6.5" />
      <path d="M6.25 9.5v9a1.25 1.25 0 0 0 1.25 1.25h9a1.25 1.25 0 0 0 1.25-1.25v-9" />
      <path d="M10.25 19.75v-5.5h3.5v5.5" />
    </svg>
  </button>
  <AccountMenu v-if="showAccount" />
</template>
