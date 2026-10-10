import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import MySQLStoreFactory from 'express-mysql-session'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { securityHeaders } from './securityHeaders.js'
import { messagesRouter } from './routes/messages.js'
import { devlogRouter } from './routes/devlog.js'
import { authRouter } from './routes/auth.js'
import { blogRouter } from './routes/blog.js'
import { shareRouter } from './routes/share.js'
import { adminRouter } from './routes/admin.js'
import { startChatServer } from './ws/chatServer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
// 经 nginx 反代时，信任代理头以正确识别 https 与客户端真实 IP；
// 否则生产的 secure cookie（登录态）在反代后无法下发。
app.set('trust proxy', 1)

// limit 提至 1mb：文字分享接口需要粘贴较长文本（其余接口不受影响）
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// 安全响应头（CSP/nosniff/防点击劫持/HSTS），须先于路由与静态托管注册
app.use(securityHeaders)

// 健康检查（nginx/监控/PM2 探活用）：验证进程存活 + 数据库连通性。
// 放在 session 中间件之前，探活请求不创建会话、不落库写 sessions 表。
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'ok' })
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' })
  }
})

// 生产强制要求显式 SESSION_SECRET：回退默认值意味着会话签名密钥公开可猜，
// 宁可启动失败（.env 丢失/漏配）也不要带着可伪造的会话悄悄上线。
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('[启动失败] 生产环境必须设置 SESSION_SECRET（server/.env），拒绝以默认密钥启动')
  process.exit(1)
}

// 会话持久化：接入现有 mysql2 连接池（自动建 sessions 表），服务重启不再全员登出。
// express-mysql-session 是 CJS 工厂，需传入 express-session 模块以取得 Store 基类。
const createMysqlSessionStore = MySQLStoreFactory as unknown as (
  sessionModule: typeof session
) => new (options: object, db: unknown) => object
const MySQLStore = createMysqlSessionStore(session)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: new MySQLStore({}, pool) as any,
    cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' },
  })
)

// API 路由（镜像原 PHP 接口）
app.use('/api/messages', messagesRouter)
app.use('/api/devlog', devlogRouter)
app.use('/api/auth', authRouter)
app.use('/api/blog', blogRouter)
app.use('/api/share', shareRouter)
// 管理面板聚合接口（统一 admin 白名单门禁，路由内部自行 401/403）
app.use('/api/admin', adminRouter)

// 生产：托管前端构建产物并做 SPA 回退
const distDir = path.resolve(__dirname, '../../client/dist')
app.use(express.static(distDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const PORT = Number(process.env.PORT) || 3000
const httpServer = app.listen(PORT, () => {
  console.log(`Express 服务已启动: http://localhost:${PORT}`)
})

// 启动 WebSocket 聊天服务器（拿到 wss 实例供优雅停机收口）
const chatWss = startChatServer()

// 优雅停机（PM2 reload 发 SIGINT/SIGTERM）：停进线 → 断开聊天连接 → 关连接池。
// 10 秒兜底强退，避免个别悬挂连接拖住进程。
let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`收到 ${signal}，开始优雅停机…`)
  httpServer.close(() => console.log('HTTP 服务已关闭'))
  // 聊天客户端直接断开（客户端有重连逻辑），再关 wss（SSL 模式联动关 https server）
  chatWss.clients.forEach((client) => client.terminate())
  chatWss.close(() => console.log('WebSocket 服务已关闭'))
  const forceExit = setTimeout(() => {
    console.log('优雅停机超时，强制退出')
    process.exit(1)
  }, 10_000)
  forceExit.unref()
  pool
    .end()
    .then(() => {
      console.log('数据库连接池已关闭，优雅停机完成')
      process.exit(0)
    })
    .catch(() => process.exit(0))
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
