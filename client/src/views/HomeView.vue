<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import ContactPanel from '../components/ContactPanel.vue'
import MessageCard from '../components/MessageCard.vue'
import { api } from '../composables/useApi'
import type { Message } from '../types'

const router = useRouter()
const messages = ref<Message[]>([])
const name = ref('')
const message = ref('')

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
  <div class="page-home">
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
</template>
