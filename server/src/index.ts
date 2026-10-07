import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import MySQLStoreFactory from 'express-mysql-session'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { messagesRouter } from './routes/messages.js'
import { devlogRouter } from './routes/devlog.js'
import { authRouter } from './routes/auth.js'
import { blogRouter } from './routes/blog.js'
import { shareRouter } from './routes/share.js'
import { startChatServer } from './ws/chatServer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
// 经 nginx 反代时，信任代理头以正确识别 https 与客户端真实 IP；
// 否则生产的 secure cookie（登录态）在反代后无法下发。
app.set('trust proxy', 1)

// limit 提至 1mb：文字分享接口需要粘贴较长文本（其余接口不受影响）
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

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

// 生产：托管前端构建产物并做 SPA 回退
const distDir = path.resolve(__dirname, '../../client/dist')
app.use(express.static(distDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => {
  console.log(`Express 服务已启动: http://localhost:${PORT}`)
})

// 启动 WebSocket 聊天服务器
startChatServer()
