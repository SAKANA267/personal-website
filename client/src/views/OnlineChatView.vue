<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import MessageCard from '../components/MessageCard.vue'
import { useWebSocket } from '../composables/useWebSocket'

const container = ref<HTMLElement | null>(null)
const input = ref('')

const { messages, connect, sendMessage: send, disconnect } = useWebSocket(async () => {
  // 自动滚动到底部
  await nextTick()
  if (container.value) container.value.scrollTop = container.value.scrollHeight
})

function sendMessage() {
  const text = input.value
  send(text)
  input.value = ''
}

onMounted(connect)
onUnmounted(disconnect)
</script>

<template>
  <div class="page-chat">
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }, { label: 'Blog', to: '/blog' }]" />

    <div class="container">
      <h1>Online Chat</h1>
      <WriterByline />

      <h2>消息日志：</h2>
      <div id="messageContainer" ref="container">
        <MessageCard
          v-for="(msg, index) in messages"
          :key="index"
          :sender="msg.sender"
          :message="msg.message"
          :timestamp="msg.timestamp"
        />
      </div>

      <div>
        <input type="text" id="messageInput" v-model="input" placeholder="请输入文本" />
        <button class="btn" @click="sendMessage">发送</button>
      </div>
    </div>
  </div>
</template>
