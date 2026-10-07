import type { Request } from 'express'

// 登录态/管理员判定：管理员白名单走 .env 的 ADMIN_USERNAMES（逗号分隔），
// 不动 users 表结构；未配置白名单时无管理员（相关写接口一律 403）。

export function sessionUsername(req: Request): string | null {
  const name = (req.session as any)?.username
  return typeof name === 'string' && name !== '' ? name : null
}

export function isAdmin(req: Request): boolean {
  const name = sessionUsername(req)
  if (!name) return false
  const whitelist = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return whitelist.includes(name)
}
