<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import TitleCardHero from '../components/TitleCardHero.vue'
import WriterByline from '../components/WriterByline.vue'
import ContactPanel from '../components/ContactPanel.vue'
import MessageCard from '../components/MessageCard.vue'
import { api } from '../composables/useApi'
import type { Message } from '../types'

const router = useRouter()
const messages = ref<Message[]>([])
const name = ref('')
const message = ref('')

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
      </div>

      <h2>Contact Me</h2>
      <ContactPanel />

      <h2>Chat</h2>
      <div class="chat-section">
        <form id="message-form" @submit.prevent="submitMessage">
          <div class="form-group">
            <label for="name">姓名:</label>
            <input type="text" id="name" v-model="name" required />
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
        />
      </div>
    </div>
  </div>
</template>
