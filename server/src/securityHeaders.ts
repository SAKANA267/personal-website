import type { Request, Response, NextFunction } from 'express'

/**
 * 安全响应头（零依赖中间件，须在路由/静态托管之前注册）。
 *
 * CSP 按站点实际载荷面收紧：
 *  - 脚本仅自身源（SPA 无内联脚本）；
 *  - 样式放行内联：Vue 的 :style 动态样式属性受 style-src 约束，禁掉会破版；
 *  - 图片放行 data:/blob:（二维码 canvas 导出）；
 *  - connect 放行 ws:/wss:（聊天/屏幕转播在独立的 9000 端口）；
 *  - frame 允许同源（图表实验室页以 iframe 内嵌）。
 *
 * 例外：/charts-lab/* 的静态演示页是自包含 HTML（内联 <script>/<style>），
 * 对它们跳过 CSP（其余安全头仍然生效），避免为演示页把整站降级到 unsafe-inline。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const path = req.path ?? ''
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // 经 https 访问时生效（http 下浏览器忽略），约束后续访问一律走 TLS
    'Strict-Transport-Security': 'max-age=31536000',
  }
  const isChartsLab = path.startsWith('/charts-lab/') || path.startsWith('/web/charts-lab/')
  if (!isChartsLab) headers['Content-Security-Policy'] = CSP
  res.set(headers)
  next()
}
