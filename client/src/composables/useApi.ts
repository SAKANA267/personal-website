import type {
  Message, DevLogEntry, User, ShareItem, BlogPost, PostComment, PostLikes,
  UserProfile, ProfilePrivacy, ProfileComment, SocialLink, SearchScope, ServerSearchResults,
  TrackingProject, TrackingPoint,
} from '../types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal })
  return res.json()
}

async function post<T = unknown>(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as T }
}

async function request<T = unknown>(method: 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as T }
}

// 文件上传走 XHR：fetch 拿不到上传进度，这里用 onprogress 回调驱动进度条
function postForm<T = unknown>(
  path: string,
  form: FormData,
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        data: (xhr.response ?? {}) as T,
      })
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.send(form)
  })
}

// 薄封装，对应原 PHP 接口
export const api = {
  getMessages: () => getJson<Message[]>('/messages'),
  postMessage: (data: { name: string; message: string }) => post('/messages', data),
  getDevLogs: () => getJson<DevLogEntry[]>('/devlog'),
  postDevLog: (data: { content: string }) => post('/devlog', data),
  // 注册与登录同样需附 ALTCHA PoW 解（widget 解出后由表单页填入）
  signup: (data: User & { altcha?: string }) =>
    post<{ success?: boolean; error?: string }>('/auth/signup', data),
  // 登录需附 ALTCHA PoW 解（widget 解出后由 LoginView 填入）；挑战题面地址供 widget 拉取
  login: (data: User & { altcha?: string }) =>
    post<{ success?: boolean; username?: string; isAdmin?: boolean; error?: string }>('/auth/login', data),
  altchaChallengeUrl: () => `${BASE}/auth/altcha-challenge`,
  // 会话校验要区分 401（未登录）与网络失败，getJson 拿不到状态码，按 getShare 的方式自带 fetch
  me: async () => {
    const res = await fetch(`${BASE}/auth/me`)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: data as { username?: string; isAdmin?: boolean; error?: string } }
  },
  logout: () => post('/auth/logout', {}),
  // 账号中心：修改密码（需已登录 + 旧密码校验）
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    post<{ success?: boolean; error?: string }>('/auth/change-password', data),
  // 管理员重置任意用户密码（找回密码的最小闭环，线下核实身份后使用）
  adminResetPassword: (data: { username: string; newPassword: string }) =>
    post<{ success?: boolean; username?: string; error?: string }>('/auth/admin/reset-password', data),
  // 聊天 WS 一次性握手令牌（登录后连接聊天时换取）
  wsToken: () => post<{ token?: string; error?: string }>('/auth/ws-token', {}),
  // 留言审核：管理员隐藏/恢复留言
  setMessageDisplayed: (id: number, isDisplayed: 0 | 1) =>
    request<{ success?: boolean; error?: string }>('PATCH', `/messages/${id}`, { is_displayed: isDisplayed }),
  // 二维码分享：文字走 JSON，图片/文件走 multipart（带进度条），取件/下载直接给 URL
  createTextShare: (data: { content: string; expiresIn: string | null }) =>
    post<{ success?: boolean; item?: ShareItem; error?: string }>('/share/text', data),
  createFileShare: (
    file: File,
    kind: 'image' | 'file',
    expiresIn: string | null,
    onProgress?: (pct: number) => void
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    if (expiresIn) form.append('expiresIn', expiresIn)
    return postForm<{ success?: boolean; item?: ShareItem; error?: string }>(
      '/share/file',
      form,
      onProgress
    )
  },
  getShare: async (code: string) => {
    const res = await fetch(`${BASE}/share/${encodeURIComponent(code)}`)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: data as ShareItem & { error?: string } }
  },
  shareFileUrl: (code: string) => `${BASE}/share/${encodeURIComponent(code)}/file`,
  shareDownloadUrl: (code: string) => `${BASE}/share/${encodeURIComponent(code)}/download`,
  // 登录适配：我的分享列表 / 删除自己的分享
  getMyShares: () => getJson<ShareItem[]>('/share/mine'),
  deleteShare: (code: string) =>
    request<{ success?: boolean; error?: string }>('DELETE', `/share/${encodeURIComponent(code)}`),
  // 博客登录联动：用户文章（DB）与评论/点赞
  getDbPosts: () => getJson<BlogPost[]>('/blog'),
  getDbPost: async (slug: string) => {
    const res = await fetch(`${BASE}/blog/${encodeURIComponent(slug)}`)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: data as BlogPost & { error?: string } }
  },
  createPost: (data: { title: string; category: string; tags: string[]; body: string; is_published: 0 | 1 }) =>
    post<{ success?: boolean; post?: BlogPost; error?: string }>('/blog', data),
  updatePost: (id: number, data: { title: string; category: string; tags: string[]; body: string; is_published: 0 | 1 }) =>
    fetch(`${BASE}/blog/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(async (res) => ({ ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as { success?: boolean; post?: BlogPost; error?: string } })),
  deletePost: (id: number) =>
    request<{ success?: boolean; error?: string }>('DELETE', `/blog/${id}`),
  // 博客插图：multipart 上传（带进度条）；url 由客户端按 BASE 拼接（生产在 /web 前缀下）
  uploadBlogImage: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return postForm<{ success?: boolean; image?: { name: string; url: string; mime: string; size: number; displaySize: number | null }; error?: string }>(
      '/blog/images',
      form,
      onProgress
    )
  },
  blogImageUrl: (name: string) => `${BASE}/blog/images/${encodeURIComponent(name)}`,
  getBlogImageMeta: (name: string) =>
    getJson<{ name: string; origSize: number; dispSize: number | null }>(
      `/blog/images/${encodeURIComponent(name)}/meta`
    ),
  deleteBlogImage: (name: string) =>
    request<{ success?: boolean; error?: string }>('DELETE', `/blog/images/${encodeURIComponent(name)}`),
  getComments: (slug: string) => getJson<PostComment[]>(`/blog/${encodeURIComponent(slug)}/comments`),
  addComment: (slug: string, content: string) =>
    post<{ success?: boolean; comment?: PostComment; error?: string }>(`/blog/${encodeURIComponent(slug)}/comments`, { content }),
  deleteComment: (id: number) =>
    request<{ success?: boolean; error?: string }>('DELETE', `/blog/comments/${id}`),
  getLikes: (slug: string) => getJson<PostLikes>(`/blog/${encodeURIComponent(slug)}/likes`),
  toggleLike: (slug: string) =>
    post<PostLikes & { error?: string }>(`/blog/${encodeURIComponent(slug)}/likes`, {}),
  // ---------- 个人主页 ----------
  // 公开主页资料（隐私裁剪在服务端完成；404/410/403 由调用方按状态码分流展示）
  getProfile: async (username: string) => {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}/profile`)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: data as UserProfile & { error?: string } }
  },
  // 主页「文章」标签（本人含草稿；他人仅已发布且受 show_content 门禁）
  getUserPosts: async (username: string, page: number, pageSize = 10) => {
    const res = await fetch(
      `${BASE}/users/${encodeURIComponent(username)}/posts?page=${page}&pageSize=${pageSize}`
    )
    const data = await res.json().catch(() => ({}))
    return {
      ok: res.ok,
      status: res.status,
      data: data as { rows: BlogPost[]; total: number; page: number; pageSize: number } & { error?: string },
    }
  },
  // 主页「评论」标签
  getUserComments: async (username: string, page: number, pageSize = 10) => {
    const res = await fetch(
      `${BASE}/users/${encodeURIComponent(username)}/comments?page=${page}&pageSize=${pageSize}`
    )
    const data = await res.json().catch(() => ({}))
    return {
      ok: res.ok,
      status: res.status,
      data: data as { rows: ProfileComment[]; total: number; page: number; pageSize: number } & { error?: string },
    }
  },
  // 编辑个人资料（登录，本人）
  updateProfile: (data: { displayName: string; bio: string; region: string; socialLinks: SocialLink[] }) =>
    request<{ success?: boolean; error?: string }>('PUT', '/auth/profile', data),
  // 隐私设置（登录，本人；保存即生效）
  updatePrivacy: (data: ProfilePrivacy) =>
    request<{ success?: boolean; error?: string }>('PUT', '/auth/privacy', data),
  // 头像：multipart 上传（服务端统一重编码 256×256 WebP）；删除后回落默认首字头像
  uploadAvatar: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return postForm<{ success?: boolean; avatar?: string; error?: string; maxMb?: number }>(
      '/auth/avatar',
      form,
      onProgress
    )
  },
  deleteAvatar: () => request<{ success?: boolean; error?: string }>('DELETE', '/auth/avatar'),
  // 壁纸：multipart 上传（服务端等比压到 ≤1600×400 WebP，条带裁切交给前端）；删除后回落无条带布局
  uploadBanner: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return postForm<{ success?: boolean; banner?: string; error?: string; maxMb?: number }>(
      '/auth/banner',
      form,
      onProgress
    )
  },
  deleteBanner: () => request<{ success?: boolean; error?: string }>('DELETE', '/auth/banner'),
  // 用户图片文件地址（头像/壁纸同一路由；不可变内容长缓存；生产在 /web 前缀下）
  avatarUrl: (name: string) => `${BASE}/users/avatars/${encodeURIComponent(name)}`,
  // 注销账号：旧密码验证身份 + 输入用户名二次确认（服务端级联删除内容并匿名化账号行）
  deleteAccount: (data: { password: string; confirm: string }) =>
    post<{ success?: boolean; error?: string }>('/auth/delete-account', data),
  // ---------- 全站搜索（Ctrl+K 弹窗） ----------
  // DB 内容分组检索（signal 供弹窗防抖中止旧请求；失败由调用方降级为本地结果）
  search: async (q: string, signal?: AbortSignal) => {
    const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`, { signal })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: data as ServerSearchResults & { error?: string } }
  },
  // 检索模块开关下发（管理面板「搜索设置」配置，60s 缓存）
  getSearchScope: (signal?: AbortSignal) => getJson<{ modules: SearchScope }>('/search/config', signal),
  // ---------- 数值追踪（登录私有数据；recordedAt 为本地时间字符串，空由服务端取 NOW()） ----------
  getTrackingProjects: () => getJson<TrackingProject[]>('/tracking/projects'),
  createTrackingProject: (data: { name: string; unit?: string; description?: string; color?: string | null }) =>
    post<{ success?: boolean; project?: TrackingProject; error?: string }>('/tracking/projects', data),
  updateTrackingProject: (
    id: number,
    data: { name: string; unit?: string; description?: string; color?: string | null }
  ) =>
    request<{ success?: boolean; project?: TrackingProject; error?: string }>('PUT', `/tracking/projects/${id}`, data),
  deleteTrackingProject: (id: number) =>
    request<{ success?: boolean; error?: string }>('DELETE', `/tracking/projects/${id}`),
  getTrackingPoints: (projectId: number) =>
    getJson<TrackingPoint[]>(`/tracking/projects/${projectId}/points`),
  addTrackingPoint: (projectId: number, data: { value: number; recordedAt?: string; note?: string }) =>
    post<{ success?: boolean; point?: TrackingPoint; error?: string }>(`/tracking/projects/${projectId}/points`, data),
  updateTrackingPoint: (id: number, data: { value?: number; recordedAt?: string; note?: string }) =>
    request<{ success?: boolean; point?: TrackingPoint; error?: string }>('PUT', `/tracking/points/${id}`, data),
  deleteTrackingPoint: (id: number) =>
    request<{ success?: boolean; error?: string }>('DELETE', `/tracking/points/${id}`),
}
