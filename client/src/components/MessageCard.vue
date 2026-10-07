<script setup lang="ts">
// 留言板 / 聊天的单条消息卡片。index 用于首页的交错淡入延迟；聊天不传则无延迟。
defineProps<{
  sender: string
  message: string
  timestamp?: string
  index?: number
}>()
</script>

<template>
  <div
    class="message messageFadeIn"
    :style="index !== undefined ? { animationDelay: (index + 1) * 0.15 + 's' } : {}"
  >
    <div class="message-header">
      <span class="message-sender">{{ sender }}</span>
    </div>
    <div class="message-content">{{ message }}</div>
    <p v-if="timestamp" class="timestamp">{{ timestamp }}</p>
    <!-- 登录适配：管理员审核操作插槽（首页留言板隐藏/恢复），默认不渲染 -->
    <slot name="actions"></slot>
  </div>
</template>
