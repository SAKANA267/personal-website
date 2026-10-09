<script setup lang="ts">
// 署名：默认 SAKANA（静态内容），用户文章传入作者用户名
defineProps<{ author?: string }>()
</script>

<template>
  <p id="writer"><em>written by {{ author || 'SAKANA' }}</em></p>
</template>
