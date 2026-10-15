<script setup lang="ts">
import { useLocale } from '../stores/locale'

// 留言板 / 聊天的单条消息卡片。index 用于首页的交错淡入延迟；聊天不传则无延迟。
// identity（仅聊天页传）：发送者为注册用户时的身份条——头像（无则首字母圆标）
// + 姓名整体渲染为跳转 /u/:username 的链接（聊天↔个人主页联动）；留言板不传，渲染不变。
defineProps<{
  sender: string
  message: string
  timestamp?: string
  index?: number
  identity?: { username: string; avatarUrl?: string }
}>()

const { t } = useLocale()
</script>

<template>
  <div
    class="message messageFadeIn"
    :style="index !== undefined ? { animationDelay: (index + 1) * 0.15 + 's' } : {}"
  >
    <div class="message-header">
      <RouterLink
        v-if="identity"
        class="message-identity"
        :to="`/u/${encodeURIComponent(identity.username)}`"
        :title="t('chat.viewProfile', { name: identity.username })"
      >
        <img
          v-if="identity.avatarUrl"
          class="message-avatar"
          :src="identity.avatarUrl"
          :alt="t('chat.avatarAlt', { name: identity.username })"
        />
        <span v-else class="message-avatar message-avatar--letter" aria-hidden="true">{{
          identity.username.charAt(0).toUpperCase()
        }}</span>
        <span class="message-sender">{{ sender }}</span>
      </RouterLink>
      <span v-else class="message-sender">{{ sender }}</span>
    </div>
    <div class="message-content">{{ message }}</div>
    <p v-if="timestamp" class="timestamp">{{ timestamp }}</p>
    <!-- 登录适配：管理员审核操作插槽（首页留言板隐藏/恢复），默认不渲染 -->
    <slot name="actions"></slot>
  </div>
</template>
