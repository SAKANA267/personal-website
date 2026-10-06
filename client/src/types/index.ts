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
// 内容来源：client/src/content/posts/*.md（frontmatter + 正文），文件名即 slug
export interface BlogPost {
  slug: string // 由 .md 文件名派生，用作路由 /blog/:slug 与列表 key
  title: string // 中文标题（frontmatter）
  excerpt: string // 中文摘要（frontmatter）
  date: string // 'YYYY-MM-DD'（frontmatter，时间序标记）
  category: string // 分类，如 '前端' | '设计' | '随笔'（frontmatter）
  tags: string[] // 标签，如 ['vue', 'design']（frontmatter）
  readTime?: number // 阅读时长（分钟）（frontmatter）
  content?: string // 原始 Markdown 正文（仅详情页使用）
  id?: number // 遗留字段（数据库时代），文件驱动下不再使用
}

// 二维码分享条目（/share 上传生成，/share/:code 扫码取件）
export interface ShareItem {
  code: string
  type: 'text' | 'image' | 'file'
  title: string // 展示标题：文字取首行截断，文件用原始文件名
  mimeType: string | null
  size: number | null // 文件字节数（text 为 null）
  content: string | null // type=text 时的正文
  createdAt: string
  expiresAt: string | null // null = 永久
  views: number // 取件页打开次数
  downloads: number // 下载次数
}
