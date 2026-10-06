import type { Message, DevLogEntry, User, ShareItem } from '../types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
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
  signup: (data: User) => post('/auth/signup', data),
  login: (data: User) => post('/auth/login', data),
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
}
