<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import TitleCardHero from '../components/TitleCardHero.vue'
import WriterByline from '../components/WriterByline.vue'
import ContactPanel from '../components/ContactPanel.vue'
import MessageCard from '../components/MessageCard.vue'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'
import type { Message } from '../types'

const router = useRouter()
const messages = ref<Message[]>([])
const name = ref('')
const message = ref('')
// 登录适配：留言姓名预填登录用户名（只读）；管理员可隐藏/恢复留言。
// 登录/账号入口是 App 级 CornerNav 右上角 icon（见 App.vue），首页不放文字入口。
const { username, isAdmin } = useAuth()

// 标题卡：仅本会话首次进入站点时作为首屏封面显示
const TITLE_CARD_FLAG = 'titleCardSeen'
const showTitleCard = ref(
  typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(TITLE_CARD_FLAG)
)
// 主页内容是否已揭示（标题卡收起后置 true，驱动升起动画）
const contentRevealed = ref(!showTitleCard.value)
const homeClass = computed(() => ({
  'page-home': true,
  'is-revealed': contentRevealed.value,
}))

function onHeroEnter() {
  // 标题卡收起动画已完成，揭示主页内容
  sessionStorage.setItem(TITLE_CARD_FLAG, '1')
  contentRevealed.value = true
  // 通知 App.vue 等：标题卡已揭示，可恢复 footer / 粒子
  window.dispatchEvent(new CustomEvent('titlecard:reveal'))
}

async function fetchMessages() {
  try {
    const data = await api.getMessages()
    if (Array.isArray(data)) messages.value = data
  } catch (e) {
    console.error('Error fetching messages:', e)
  }
}

async function submitMessage() {
  try {
    const res = await api.postMessage({ name: name.value, message: message.value })
    if (res.ok) {
      alert('留言提交成功！')
      name.value = ''
      message.value = ''
      fetchMessages()
    } else {
      alert('留言提交失败，请稍后再试。')
    }
  } catch (e) {
    alert('留言提交失败，请稍后再试。')
  }
}

// 登录状态变化时同步姓名框：登录 → 预填用户名；退出 → 清空回手动输入
watch(username, (u) => {
  name.value = u ?? ''
})
if (username.value) name.value = username.value

// 管理员隐藏/恢复一条留言（服务端 PATCH，成功后刷新列表）
async function toggleDisplayed(msg: Message) {
  if (msg.id == null) return
  const next: 0 | 1 = msg.is_displayed === 0 ? 1 : 0
  const res = await api.setMessageDisplayed(msg.id, next)
  if (res.ok) fetchMessages()
}

onMounted(fetchMessages)
</script>

<template>
  <div :class="homeClass">
    <!-- 首页顶部封面：标题卡英雄区（仅会话首次显示） -->
    <TitleCardHero v-if="showTitleCard" :active="showTitleCard" @enter="onHeroEnter" />

    <!-- 主页内容：标题卡存在时先隐藏（避免滚动条 / 占位），收起后升起揭示 -->
    <div class="home-body" :class="{ 'is-revealed': contentRevealed }">
      <div class="header-section">
        <h1>Welcome!</h1>
        <h1>Homepage of SAKANA</h1>
        <WriterByline />
      </div>

      <h2>Links</h2>
      <div class="container">
        <p class="btn" @click="router.push('/online-chat')">Online chat</p>
        <p class="btn" @click="router.push('/question-bank')">Question bank</p>
        <p class="btn" @click="router.push('/dev-log')">Dev log</p>
        <p class="btn" @click="router.push('/blog')">Blog</p>
        <p class="btn" @click="router.push('/share')">二维码分享</p>
      </div>

      <h2>Contact Me</h2>
      <ContactPanel />

      <h2>Chat</h2>
      <div class="chat-section">
        <form id="message-form" @submit.prevent="submitMessage">
          <div class="form-group">
            <label for="name">姓名:</label>
            <!-- 登录适配：已登录预填用户名并锁定，未登录保持手动输入 -->
            <input
              type="text"
              id="name"
              v-model="name"
              :readonly="!!username"
              :title="username ? '已登录，以 ' + username + ' 身份留言' : undefined"
              required
            />
          </div>
          <div class="form-group">
            <label for="message">留言内容:</label>
            <textarea id="message" v-model="message" required></textarea>
          </div>
          <button type="submit">提交</button>
        </form>
      </div>

      <h2>Chat board</h2>
      <div id="messages">
        <MessageCard
          v-for="(msg, index) in messages"
          :key="index"
          :sender="msg.name"
          :message="msg.message"
          :timestamp="msg.timestamp"
          :index="index"
        >
          <!-- 登录适配：管理员的隐藏/恢复操作，通过插槽挂在卡片内（不影响普通渲染） -->
          <template v-if="isAdmin" #actions>
            <p
              v-if="msg.id != null"
              class="message-admin-toggle"
              @click="toggleDisplayed(msg)"
            >
              {{ msg.is_displayed === 0 ? '恢复显示' : '隐藏' }}
            </p>
          </template>
        </MessageCard>
      </div>
    </div>
  </div>
</template>
