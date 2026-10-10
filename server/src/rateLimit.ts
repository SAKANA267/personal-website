import type { Request, Response, NextFunction } from 'express'

/**
 * 固定窗口限流（内存版，零依赖）：
 * 单实例部署（PM2 fork）够用；进程重启计数清零、多实例不共享，均属可接受范围。
 * 键默认取 req.ip（经 trust proxy 后是真实客户端 IP），各路由可用 key 叠加业务维度。
 */

export interface RateLimitOptions {
  /** 窗口长度（毫秒） */
  windowMs: number
  /** 窗口内放行的最大请求数 */
  max: number
  /** 自定义限流键；缺省按 IP */
  key?: (req: Request) => string
}

interface WindowState {
  count: number
  resetAt: number
}

const windows = new Map<string, WindowState>()
/** 防内存膨胀：超过该规模时顺带清扫过期窗口（摊销，不另起定时器） */
const SWEEP_THRESHOLD = 5000

/** 每个限流器实例一个命名空间：不同路由各自计数，互不挤占额度 */
let instanceSeq = 0

function sweep(now: number) {
  for (const [k, v] of windows) {
    if (v.resetAt <= now) windows.delete(k)
  }
}

export function rateLimit(opts: RateLimitOptions) {
  const ns = `rl${++instanceSeq}`
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (windows.size > SWEEP_THRESHOLD) sweep(now)

    const k = `${ns}:${opts.key ? opts.key(req) : String(req.ip ?? 'unknown')}`
    let state = windows.get(k)
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + opts.windowMs }
      windows.set(k, state)
    }
    state.count += 1

    if (state.count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000))
      res
        .status(429)
        .set('Retry-After', String(retryAfter))
        .json({ error: 'RATE_LIMITED', retryAfterSec: retryAfter })
      return
    }
    next()
  }
}
