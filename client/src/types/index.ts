// 留言板消息
export interface Message {
  name: string
  message: string
  timestamp: string
}

// 开发日志条目
export interface DevLogEntry {
  timestamp: string
  change_description: string
}

// 选择题（题库数据模型，与原项目一致）
export interface Question {
  question: string
  options: string[]
  answer: string
}

// 聊天消息
export interface ChatMessage {
  sender: string
  message: string
  timestamp?: string
}

// 屏幕转播信令帧（wire format 为 'RTC:' + JSON，经聊天 WebSocket 传输）
// 客户端 → 服务端（定向消息带 to）
export type RtcClientMessage =
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'watch'; to: string }
  | { t: 'leave'; to: string }
  | { t: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { t: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { t: 'ice'; to: string; candidate: RTCIceCandidateInit }

// 服务端 → 客户端（转发消息带 from）
export type RtcServerMessage =
  | { t: 'welcome'; id: string; host: { id: string; label: string } | null }
  | { t: 'started'; from: string; label: string }
  | { t: 'stopped'; from: string }
  | { t: 'denied'; reason: string }
  | { t: 'watch'; from: string }
  | { t: 'leave'; from: string }
  | { t: 'offer'; from: string; sdp: RTCSessionDescriptionInit }
  | { t: 'answer'; from: string; sdp: RTCSessionDescriptionInit }
  | { t: 'ice'; from: string; candidate: RTCIceCandidateInit }

// 用户（仅在网络传输时携带 password）
export interface User {
  username: string
  password: string
}

// 博客文章
export interface BlogPost {
  id: number
  title: string // 中文标题
  excerpt: string // 中文摘要
  date: string // 'YYYY-MM-DD'（时间序标记）
  category: string // 分类，如 '前端' | '设计' | '随笔'
  tags: string[] // 标签，如 ['vue', 'design']
  readTime?: number // 阅读时长（分钟）
}
