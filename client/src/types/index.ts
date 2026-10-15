// 留言板消息（id/is_displayed 为管理员审核用：管理员 GET 返回，普通列表不含）
export interface Message {
  name: string
  message: string
  timestamp: string
  id?: number
  is_displayed?: number
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
// 双来源：SAKANA 静态文章 = client/src/content/posts/*.md（frontmatter + 正文，文件名即 slug）；
// 登录用户文章 = DB blog_posts（slug 以 u- 开头，author 为作者用户名，isPublished 0 = 草稿仅作者可见）
export interface BlogPost {
  slug: string // 静态：.md 文件名；用户文章：u-xxx
  title: string // 中文标题（frontmatter）
  excerpt: string // 中文摘要（frontmatter / 服务端派生）
  date: string // 'YYYY-MM-DD'（frontmatter，时间序标记）
  category: string // 分类，如 '前端' | '设计' | '随笔'（frontmatter）
  tags: string[] // 标签，如 ['vue', 'design']（用户文章可能为空数组）
  readTime?: number // 阅读时长（分钟）（frontmatter / 服务端估算）
  content?: string // 原始 Markdown 正文（静态文章详情用；用户文章详情接口返回 body）
  body?: string // 用户文章 Markdown 正文（详情接口 / 编辑加载时填充）
  author?: string // 用户文章作者用户名；undefined = SAKANA 静态文章
  isPublished?: number // 用户文章：1 发布 / 0 草稿
  id?: number // 用户文章数据库 id（编辑/删除用）
}

// 文章评论（登录用户发表，按 slug 键控——静态/用户文章均可评论）
export interface PostComment {
  id: number
  username: string
  content: string
  createdAt: string // 'YYYY-MM-DD HH:mm'
}

// 文章点赞状态
export interface PostLikes {
  count: number
  liked: boolean
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

// 社交链接（个人主页资料；服务端校验 http(s):// 前缀）
export interface SocialLink {
  label: string
  url: string
}

// 个人主页资料（GET /api/users/:username/profile）。
// 隐私裁剪在服务端完成：非本人/管理员视角下被隐藏的字段为 null/[]，
// 各 *Visible 布尔回传真实开关供本人视角标「仅自己可见」。
export interface UserProfile {
  username: string
  displayName: string | null
  avatar: string | null // 头像文件名；null = 默认首字头像
  banner: string | null // 壁纸文件名（头卡顶部条带）；null = 无壁纸不渲染条带
  bio: string | null
  region: string | null
  regionVisible: boolean
  socialLinks: SocialLink[]
  socialVisible: boolean
  createdAt: string // 注册时间
  stats: { posts: number; comments: number; likes: number }
  contentVisible: boolean // 文章/评论标签对外可见（本人恒 true）
  profilePublic: boolean // 主页是否公开（本人隐私设置表单回填用）
  allowIndex: boolean
  isSelf: boolean
  isAdmin: boolean
}

// 隐私设置（PUT /api/auth/privacy 的载荷，与 users 表五个开关一一对应）
export interface ProfilePrivacy {
  profilePublic: boolean
  showRegion: boolean
  showSocial: boolean
  showContent: boolean
  allowIndex: boolean
}

// 个人主页「评论」标签行（自己的评论 + 所属文章标题）
export interface ProfileComment {
  id: number
  postSlug: string
  postTitle: string
  content: string
  createdAt: string
}
