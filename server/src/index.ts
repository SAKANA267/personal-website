import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { messagesRouter } from './routes/messages.js'
import { devlogRouter } from './routes/devlog.js'
import { authRouter } from './routes/auth.js'
import { blogRouter } from './routes/blog.js'
import { startChatServer } from './ws/chatServer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
// 经 nginx 反代时，信任代理头以正确识别 https 与客户端真实 IP；
// 否则生产的 secure cookie（登录态）在反代后无法下发。
app.set('trust proxy', 1)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' },
  })
)

// API 路由（镜像原 PHP 接口）
app.use('/api/messages', messagesRouter)
app.use('/api/devlog', devlogRouter)
app.use('/api/auth', authRouter)
app.use('/api/blog', blogRouter)

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
