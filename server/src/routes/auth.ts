import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { issueWsToken } from '../wsTokens.js'

export const authRouter = Router()

// 注册新密码的最小长度（只约束新注册，不影响存量短密码用户登录）
const PASSWORD_MIN = 6

// 输入防护：用户名不超过 users.username 列宽；密码不超过 bcrypt 的 72 字节截断上限
// （超出会被 bcrypt 静默截断，与其让用户用"半个密码"登录，不如直接拒绝）
// i18n 适配：错误一律返回机器码，由前端按语言查表展示；带参数的码附在同级字段
function invalidCredentials(username: unknown, password: unknown): { code: string; min?: number } | null {
  if (typeof username !== 'string' || username.trim() === '') return { code: 'AUTH_USERNAME_REQUIRED' }
  if (username.length > 255) return { code: 'AUTH_USERNAME_TOO_LONG' }
  if (typeof password !== 'string' || password === '') return { code: 'AUTH_PASSWORD_REQUIRED' }
  if (Buffer.byteLength(password, 'utf8') > 72) return { code: 'AUTH_PASSWORD_TOO_LONG' }
  return null
}

// 对应 sign_up.php：bcrypt 哈希后写入用户
authRouter.post('/signup', async (req, res) => {
  try {
    const username = req.body?.username
    const password = req.body?.password
    const invalid = invalidCredentials(username, password)
    if (invalid) {
      res.status(400).json({ error: invalid.code })
      return
    }
    if (password.length < PASSWORD_MIN) {
      res.status(400).json({ error: 'AUTH_PASSWORD_MIN', min: PASSWORD_MIN })
      return
    }
    const hashed = await bcrypt.hash(password, 10)
    await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed])
    res.json({ success: true })
  } catch (e: any) {
    // 用户名唯一约束冲突 → 友好提示
    if (e.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'AUTH_USERNAME_EXISTS' })
    } else {
      console.error('signup failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
})

// 对应 login.php：原实现明文比对 bcrypt 哈希导致永远失败，这里修复为正确的 bcrypt 比对
authRouter.post('/login', async (req, res) => {
  try {
    const username = req.body?.username
    const password = req.body?.password
    const invalid = invalidCredentials(username, password)
    if (invalid) {
      res.status(400).json({ error: invalid.code })
      return
    }
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    const user = (rows as any[])[0]
    if (user && (await bcrypt.compare(password, user.password))) {
      ;(req.session as any).username = username
      res.json({ success: true, username, isAdmin: isAdmin(req) })
    } else {
      res.status(401).json({ error: 'AUTH_INVALID_CREDENTIALS' })
    }
  } catch (e: any) {
    console.error('login failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 会话校验：客户端启动时据此同步登录态（session cookie 是唯一事实源）
authRouter.get('/me', (req, res) => {
  const username = (req.session as any).username
  if (typeof username === 'string' && username !== '') {
    res.json({ username, isAdmin: isAdmin(req) })
  } else {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
  }
})

// 登出：销毁服务端会话并清掉客户端 cookie
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid').json({ success: true })
  })
})

// 修改密码：需已登录 + 旧密码校验；新密码同样受最小长度与 72 字节上限约束
authRouter.post('/change-password', async (req, res) => {
  const username = sessionUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  try {
    const oldPassword = req.body?.oldPassword
    const newPassword = req.body?.newPassword
    if (typeof oldPassword !== 'string' || oldPassword === '') {
      res.status(400).json({ error: 'AUTH_OLD_PASSWORD_REQUIRED' })
      return
    }
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN) {
      res.status(400).json({ error: 'AUTH_PASSWORD_MIN', min: PASSWORD_MIN })
      return
    }
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      res.status(400).json({ error: 'AUTH_PASSWORD_TOO_LONG' })
      return
    }
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    const user = (rows as any[])[0]
    if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
      res.status(401).json({ error: 'AUTH_OLD_PASSWORD_WRONG' })
      return
    }
    const hashed = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id])
    res.json({ success: true })
  } catch (e: any) {
    console.error('change-password failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// WS 握手令牌：一次性、60 秒有效，把登录身份带过 9000 端口的 WebSocket 连接
authRouter.post('/ws-token', (req, res) => {
  const username = sessionUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  res.json({ token: issueWsToken(username) })
})
