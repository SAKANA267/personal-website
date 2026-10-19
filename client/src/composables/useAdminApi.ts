// 管理面板数据层：/api/admin/* 聚合接口的 typed 封装。
// 列表统一分页形状 { rows, total, page, pageSize }；写操作尽量复用既有业务接口
// （api.setMessageDisplayed / api.deletePost / api.deleteComment / api.deleteShare /
//  api.postDevLog / api.adminResetPassword），这里只补面板专属的 publish 开关与过期清理。
import { api } from './useApi'
import type { SearchScope } from '../types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

export interface AdminListQuery {
  page?: number
  pageSize?: number
  q?: string
}

export interface AdminPaged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface AdminOverview {
  counts: {
    users: number
    messages: number
    messagesHidden: number
    devlog: number
    posts: number
    postsDraft: number
    comments: number
    likes: number
    blogImages: number
    shares: number
    sharesActive: number
    logs: number
    lastMessageAt: string | null
  }
  recentMessages: { id: number; name: string; message: string; timestamp: string; is_displayed: number }[]
  recentLogs: { id: number; sender: string; message: string; timestamp: string }[]
  server: { uptimeSec: number; nodeVersion: string; now: string }
}

export interface AdminMessage {
  id: number
  name: string
  message: string
  timestamp: string
  is_displayed: number
}

export interface AdminDevLog {
  id: number
  timestamp: string
  change_description: string
}

export interface AdminPost {
  id: number
  slug: string
  title: string
  author: string
  category: string
  date: string
  isPublished: number
  readTime: number | null
  commentCount: number
  likeCount: number
}

export interface AdminComment {
  id: number
  post_slug: string
  username: string
  content: string
  createdAt: string
}

export interface AdminShare {
  id: number
  code: string
  type: 'text' | 'image' | 'file'
  title: string
  mimeType: string | null
  size: number | null
  views: number
  downloads: number
  uploaderUser: string | null
  uploaderIp: string | null
  expiresAt: string | null
  expired: number
  createdAt: string
}

export interface AdminUser {
  id: number
  username: string
  status: 'active' | 'disabled' | 'deleted'
  displayName: string | null
  createdAt: string
  posts: number
  comments: number
  likes: number
  shares: number
}

export interface AdminLog {
  id: number
  sender: string
  message: string
  timestamp: string
}

function qs(query: AdminListQuery): string {
  const p = new URLSearchParams()
  if (query.page) p.set('page', String(query.page))
  if (query.pageSize) p.set('pageSize', String(query.pageSize))
  if (query.q && query.q.trim()) p.set('q', query.q.trim())
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function getList<T>(path: string, query: AdminListQuery): Promise<AdminPaged<T>> {
  const res = await fetch(`${BASE}/admin/${path}${qs(query)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data?.error || 'REQUEST_FAILED'), { status: res.status })
  return data as AdminPaged<T>
}

async function mutate<T = unknown>(method: 'PATCH' | 'POST' | 'PUT', path: string, body?: unknown) {
  const res = await fetch(`${BASE}/admin/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data?.error || 'REQUEST_FAILED'), { status: res.status })
  return data as T
}

export const adminApi = {
  overview: async (): Promise<AdminOverview> => {
    const res = await fetch(`${BASE}/admin/overview`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data?.error || 'REQUEST_FAILED'), { status: res.status })
    return data as AdminOverview
  },
  messages: (q: AdminListQuery) => getList<AdminMessage>('messages', q),
  devlog: (q: AdminListQuery) => getList<AdminDevLog>('devlog', q),
  posts: (q: AdminListQuery) => getList<AdminPost>('posts', q),
  comments: (q: AdminListQuery) => getList<AdminComment>('comments', q),
  shares: (q: AdminListQuery) => getList<AdminShare>('shares', q),
  users: (q: AdminListQuery) => getList<AdminUser>('users', q),
  logs: (q: AdminListQuery) => getList<AdminLog>('logs', q),
  // 面板专属写操作（其余复用 api.*）
  setPostPublished: (id: number, isPublished: 0 | 1) =>
    mutate<{ success: boolean }>('PATCH', `posts/${id}/publish`, { is_published: isPublished }),
  // 禁用/启用账号（白名单管理员不可被禁用；被禁用账号登录被拒、存量会话下次对账失效）
  setUserStatus: (id: number, status: 'active' | 'disabled') =>
    mutate<{ success: boolean; username: string; status: string }>('PATCH', `users/${id}/status`, { status }),
  cleanupShares: () => mutate<{ success: boolean; removed: number }>('POST', 'shares/cleanup', {}),
  cleanupImages: () => mutate<{ success: boolean; removed: number }>('POST', 'images/cleanup', {}),
  // 全站搜索模块开关（搜索设置 tab；GET 为即时值——绕过公开 config 的 60s 缓存）
  getSearchConfig: async (): Promise<SearchScope> => {
    const res = await fetch(`${BASE}/admin/search-config`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data?.error || 'REQUEST_FAILED'), { status: res.status })
    return (data?.modules ?? {}) as SearchScope
  },
  putSearchConfig: (modules: SearchScope) =>
    mutate<{ success: boolean; modules: SearchScope }>('PUT', 'search-config', { modules }),
  // 透传既有业务接口，供视图统一从 adminApi 调用
  setMessageDisplayed: api.setMessageDisplayed,
  deletePost: api.deletePost,
  deleteComment: api.deleteComment,
  deleteShare: api.deleteShare,
  postDevLog: api.postDevLog,
  adminResetPassword: api.adminResetPassword,
}
