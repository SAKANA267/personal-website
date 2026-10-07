import { ref } from 'vue'
import type { ChatMessage, RtcClientMessage, RtcServerMessage } from '../types'
import { api } from './useApi'
import { useAuth } from '../stores/auth'

/**
 * 聊天 WebSocket，忠实移植原 online_chat.js：
 * - onopen/onclose 追加系统消息「连接已打开/已关闭」
 * - onmessage 兼容 Blob（FileReader）与字符串，按 ': ' 切分 name:message
 * - sendMessage 经 socket 发送并在本地回显（登录用户回显用户名，游客为「你」）
 *
 * 屏幕转播扩展（不影响上述聊天行为）：
 * - 'RTC:' 前缀的帧识别为转播信令，只分发给 onSignaling 回调，不进入消息列表
 * - sendSignaling 以 'RTC:' + JSON 发送；appendMessage 供转播写入系统提示
 *
 * 登录适配：已登录时先取一次性 ws-token 附加到连接 URL，服务端广播/日志以用户名标识；
 * 取令牌失败或游客则直连，保持原 IP 标识行为。
 */
const RTC_PREFIX = 'RTC:'

export function useWebSocket(onAppend?: () => void) {
  const messages = ref<ChatMessage[]>([])
  let socket: WebSocket | null = null
  const signalingHandlers = new Set<(msg: RtcServerMessage) => void>()
  const { username: authUsername } = useAuth()

  function appendMessage(name: string, message: string) {
    messages.value.push({
      sender: name,
      message,
      timestamp: new Date().toLocaleString(),
    })
    onAppend?.()
  }

  function dispatchSignaling(raw: string) {
    let frame: RtcServerMessage | null = null
    try {
      frame = JSON.parse(raw.slice(RTC_PREFIX.length)) as RtcServerMessage
    } catch {
      frame = null
    }
    // 解析失败按普通聊天文本展示（与服务端回落策略一致）
    if (frame && typeof frame.t === 'string') {
      signalingHandlers.forEach((cb) => cb(frame as RtcServerMessage))
    } else {
      const [name, message] = raw.split(': ')
      appendMessage(name, message)
    }
  }

  function handleData(raw: string) {
    if (raw.startsWith(RTC_PREFIX)) {
      dispatchSignaling(raw)
      return
    }
    const [name, message] = raw.split(': ')
    appendMessage(name, message)
  }

  async function connect() {
    const base = import.meta.env.VITE_WS_URL
    let url = base
    // 已登录：换取一次性令牌随握手带上，服务端据此用用户名标识本连接
    if (authUsername.value) {
      try {
        const res = await api.wsToken()
        if (res.ok && res.data?.token) {
          url = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(res.data.token)}`
        }
      } catch {
        // 取令牌失败按游客身份直连
      }
    }
    socket = new WebSocket(url)

    socket.onopen = () => {
      console.log('WebSocket 连接已打开')
      appendMessage('系统', '连接已打开')
    }

    socket.onmessage = (event) => {
      if (event.data instanceof Blob) {
        const reader = new FileReader()
        reader.onload = () => {
          console.log('收到消息: ', reader.result)
          handleData(String(reader.result))
        }
        reader.readAsText(event.data)
      } else {
        console.log('收到消息: ', event.data)
        handleData(String(event.data))
      }
    }

    socket.onclose = () => {
      console.log('WebSocket 连接已关闭')
      appendMessage('系统', '连接已关闭')
    }
  }

  function sendMessage(text: string) {
    if (!socket) return
    socket.send(text)
    appendMessage(authUsername.value || '你', text)
  }

  function onSignaling(cb: (msg: RtcServerMessage) => void) {
    signalingHandlers.add(cb)
    return () => signalingHandlers.delete(cb)
  }

  function sendSignaling(msg: RtcClientMessage) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(RTC_PREFIX + JSON.stringify(msg))
  }

  function disconnect() {
    socket?.close()
    socket = null
  }

  return { messages, connect, sendMessage, disconnect, appendMessage, onSignaling, sendSignaling }
}
