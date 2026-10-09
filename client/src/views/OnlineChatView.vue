<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import WriterByline from '../components/WriterByline.vue'
import MessageCard from '../components/MessageCard.vue'
import { useWebSocket } from '../composables/useWebSocket'
import { useScreenBroadcast } from '../composables/useScreenBroadcast'
import { useLocale } from '../stores/locale'

const { t } = useLocale()
const container = ref<HTMLElement | null>(null)
const input = ref('')

const { messages, connect, sendMessage: send, disconnect, appendMessage, onSignaling, sendSignaling } =
  useWebSocket(async () => {
    // 自动滚动到底部
    await nextTick()
    if (container.value) container.value.scrollTop = container.value.scrollHeight
  })

const {
  isBroadcasting,
  activeBroadcast,
  isWatching,
  viewerCount,
  localStream,
  remoteStream,
  startBroadcast,
  stopBroadcast,
  watchBroadcast,
  stopWatching,
  cleanup,
} = useScreenBroadcast({ onSignaling, sendSignaling, appendMessage })

const localVideo = ref<HTMLVideoElement | null>(null)
const remoteVideo = ref<HTMLVideoElement | null>(null)
const remoteMuted = ref(false)

// srcObject 无法用模板 attribute 绑定，命令式赋值（flush: 'post' 确保视频节点已挂载）
watch(
  localStream,
  (stream) => {
    if (localVideo.value) localVideo.value.srcObject = stream
  },
  { flush: 'post' },
)

watch(
  remoteStream,
  (stream) => {
    if (!remoteVideo.value) return
    remoteVideo.value.srcObject = stream
    if (!stream) return
    // 带声自动播放可能被浏览器策略拦截，降级为静音重试
    remoteVideo.value.play().catch(() => {
      if (!remoteVideo.value) return
      remoteVideo.value.muted = true
      remoteMuted.value = true
      remoteVideo.value.play().catch(() => {})
    })
  },
  { flush: 'post' },
)

function toggleMute() {
  if (!remoteVideo.value) return
  remoteMuted.value = !remoteMuted.value
  remoteVideo.value.muted = remoteMuted.value
}

function sendMessage() {
  const text = input.value
  send(text)
  input.value = ''
}

onMounted(connect)
onUnmounted(() => {
  // 离开页面前先收尾转播（停流/断开 P2P），再断开聊天连接
  cleanup()
  disconnect()
})
</script>

<template>
  <div class="page-chat">

    <div class="container">
      <h1>{{ t('chat.title') }}</h1>
      <WriterByline />

      <section id="broadcastPanel">
        <!-- 空闲：可发起转播 -->
        <div v-if="!isBroadcasting && !activeBroadcast" class="broadcast-controls">
          <span class="broadcast-status">{{ t('chat.idle') }}</span>
          <button class="btn" @click="startBroadcast">{{ t('chat.startBroadcast') }}</button>
        </div>

        <!-- 我是主播：本地预览 + 观看人数 -->
        <div v-else-if="isBroadcasting">
          <div class="broadcast-controls">
            <span class="broadcast-status"><span class="live-dot"></span>{{ t('chat.broadcasting', { n: viewerCount }) }}</span>
            <button class="btn" @click="stopBroadcast">{{ t('chat.stopBroadcast') }}</button>
          </div>
          <video ref="localVideo" class="broadcast-video" autoplay muted playsinline></video>
        </div>

        <!-- 他人转播：观看入口 -->
        <div v-else>
          <div class="broadcast-controls">
            <span class="broadcast-status">
              <span class="live-dot"></span>{{ t('chat.liveFrom', { label: activeBroadcast?.label }) }}
            </span>
            <button v-if="!isWatching" class="btn" @click="watchBroadcast">{{ t('chat.watch') }}</button>
            <template v-else>
              <button class="btn" @click="toggleMute">{{ remoteMuted ? t('chat.unmute') : t('chat.mute') }}</button>
              <button class="btn" @click="stopWatching">{{ t('chat.stopWatch') }}</button>
            </template>
          </div>
          <template v-if="isWatching">
            <video ref="remoteVideo" class="broadcast-video" autoplay playsinline></video>
            <p v-if="!remoteStream" class="broadcast-hint">{{ t('chat.connecting') }}</p>
          </template>
        </div>
      </section>

      <h2>{{ t('chat.logTitle') }}</h2>
      <div id="messageContainer" ref="container">
        <MessageCard
          v-for="(msg, index) in messages"
          :key="index"
          :sender="msg.sender"
          :message="msg.message"
          :timestamp="msg.timestamp"
        />
      </div>

      <div class="chat-input-bar">
        <input type="text" id="messageInput" v-model="input" :placeholder="t('chat.placeholder')" />
        <button class="btn" @click="sendMessage">{{ t('chat.send') }}</button>
      </div>
    </div>
  </div>
</template>
