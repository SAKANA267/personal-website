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
