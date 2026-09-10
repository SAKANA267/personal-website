import { ref } from 'vue'
import type { ChatMessage, RtcClientMessage, RtcServerMessage } from '../types'

/**
 * 聊天 WebSocket，忠实移植原 online_chat.js：
 * - onopen/onclose 追加系统消息「连接已打开/已关闭」
 * - onmessage 兼容 Blob（FileReader）与字符串，按 ': ' 切分 name:message
 * - sendMessage 经 socket 发送并在本地以「你」回显
 *
 * 屏幕转播扩展（不影响上述聊天行为）：
 * - 'RTC:' 前缀的帧识别为转播信令，只分发给 onSignaling 回调，不进入消息列表
 * - sendSignaling 以 'RTC:' + JSON 发送；appendMessage 供转播写入系统提示
 */
const RTC_PREFIX = 'RTC:'

export function useWebSocket(onAppend?: () => void) {
  const messages = ref<ChatMessage[]>([])
  let socket: WebSocket | null = null
  const signalingHandlers = new Set<(msg: RtcServerMessage) => void>()

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

  function connect() {
    const url = import.meta.env.VITE_WS_URL
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
    appendMessage('你', text)
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
