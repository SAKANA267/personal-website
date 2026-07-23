<script setup lang="ts">
import { useRouter } from 'vue-router'

defineProps<{ items: { label: string; to: string }[] }>()

const router = useRouter()
// 点击触发客户端路由（路由守卫会复刻 loading.in 的 1 秒遮罩过渡）
function go(to: string) {
  router.push(to)
}
</script>

<template>
  <div class="topnav">
    <p v-for="item in items" :key="item.to" class="btn" @click="go(item.to)">
      {{ item.label }}
    </p>
  </div>
</template>
