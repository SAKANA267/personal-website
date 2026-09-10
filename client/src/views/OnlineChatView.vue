<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import MessageCard from '../components/MessageCard.vue'
import { useWebSocket } from '../composables/useWebSocket'
import { useScreenBroadcast } from '../composables/useScreenBroadcast'

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
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }, { label: 'Blog', to: '/blog' }]" />

    <div class="container">
      <h1>Online Chat</h1>
      <WriterByline />

      <section id="broadcastPanel">
        <!-- 空闲：可发起转播 -->
        <div v-if="!isBroadcasting && !activeBroadcast" class="broadcast-controls">
          <span class="broadcast-status">当前无人转播，可分享你的屏幕 / 应用窗口</span>
          <button class="btn" @click="startBroadcast">开始转播屏幕</button>
        </div>

        <!-- 我是主播：本地预览 + 观看人数 -->
        <div v-else-if="isBroadcasting">
          <div class="broadcast-controls">
            <span class="broadcast-status"><span class="live-dot"></span>转播中 · {{ viewerCount }} 人观看</span>
            <button class="btn" @click="stopBroadcast">停止转播</button>
          </div>
          <video ref="localVideo" class="broadcast-video" autoplay muted playsinline></video>
        </div>

        <!-- 他人转播：观看入口 -->
        <div v-else>
          <div class="broadcast-controls">
            <span class="broadcast-status">
              <span class="live-dot"></span>正在转播 · 来自 {{ activeBroadcast?.label }}
            </span>
            <button v-if="!isWatching" class="btn" @click="watchBroadcast">观看直播</button>
            <template v-else>
              <button class="btn" @click="toggleMute">{{ remoteMuted ? '取消静音' : '静音' }}</button>
              <button class="btn" @click="stopWatching">停止观看</button>
            </template>
          </div>
          <template v-if="isWatching">
            <video ref="remoteVideo" class="broadcast-video" autoplay playsinline></video>
            <p v-if="!remoteStream" class="broadcast-hint">正在接入直播间…</p>
          </template>
        </div>
      </section>

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
