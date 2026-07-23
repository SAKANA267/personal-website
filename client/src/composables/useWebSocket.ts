import { ref } from 'vue'
import type { ChatMessage } from '../types'

/**
 * 聊天 WebSocket，忠实移植原 online_chat.js：
 * - onopen/onclose 追加系统消息「连接已打开/已关闭」
 * - onmessage 兼容 Blob（FileReader）与字符串，按 ': ' 切分 name:message
 * - sendMessage 经 socket 发送并在本地以「你」回显
 */
export function useWebSocket(onAppend?: () => void) {
  const messages = ref<ChatMessage[]>([])
  let socket: WebSocket | null = null

  function appendMessage(name: string, message: string) {
    messages.value.push({
      sender: name,
      message,
      timestamp: new Date().toLocaleString(),
    })
    onAppend?.()
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
          const [name, message] = String(reader.result).split(': ')
          appendMessage(name, message)
        }
        reader.readAsText(event.data)
      } else {
        console.log('收到消息: ', event.data)
        const [name, message] = String(event.data).split(': ')
        appendMessage(name, message)
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

  function disconnect() {
    socket?.close()
    socket = null
  }

  return { messages, connect, sendMessage, disconnect }
}
