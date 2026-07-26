import type { Message, DevLogEntry, User } from '../types'

const BASE = import.meta.env.VITE_API_BASE || '/api'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  return res.json()
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// 薄封装，对应原 PHP 接口
export const api = {
  getMessages: () => getJson<Message[]>('/messages'),
  postMessage: (data: { name: string; message: string }) => post('/messages', data),
  getDevLogs: () => getJson<DevLogEntry[]>('/devlog'),
  postDevLog: (data: { content: string }) => post('/devlog', data),
  signup: (data: User) => post('/auth/signup', data),
  login: (data: User) => post('/auth/login', data),
}
