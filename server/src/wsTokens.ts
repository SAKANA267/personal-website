import crypto from 'node:crypto'

// WS 一次性握手令牌：Express 侧凭 session 签发，WS 侧在握手时消费（同进程内存 Map）。
// cookie 不会随 WS 连接带到独立端口，用一次性短时 token 把"已登录"身份带过握手。
const TTL_MS = 60_000
const tokens = new Map<string, { username: string; expiresAt: number }>()

export function issueWsToken(username: string): string {
  // 顺手清理过期项，避免长时间运行累积
  const now = Date.now()
  for (const [t, v] of tokens) {
    if (v.expiresAt <= now) tokens.delete(t)
  }
  const token = crypto.randomBytes(24).toString('hex')
  tokens.set(token, { username, expiresAt: now + TTL_MS })
  return token
}

// 用后即焚：校验通过立即删除，同一 token 不能连两个 WebSocket
export function consumeWsToken(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null
  const entry = tokens.get(token)
  tokens.delete(token)
  if (!entry || entry.expiresAt <= Date.now()) return null
  return entry.username
}
