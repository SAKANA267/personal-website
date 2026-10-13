import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { issueWsToken } from '../wsTokens.js'
import { rateLimit } from '../rateLimit.js'
import { issueChallenge, verifyLoginCaptcha } from '../altcha.js'

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

// 注册接口：防脚本批量开号（按 IP 每小时 10 次）。对应 sign_up.php：bcrypt 哈希后写入用户
authRouter.post(
  '/signup',
  rateLimit({ windowMs: 60 * 60_000, max: 10 }),
  async (req, res) => {
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
    // ALTCHA PoW 验证（与登录同一套出题/核销）：验通过才写入新用户，
    // 失败（如用户名已存在）也消耗这道解，客户端会重置 widget 重解
    const captcha = await verifyLoginCaptcha(req.body?.altcha)
    if (captcha === 'required') {
      res.status(400).json({ error: 'AUTH_CAPTCHA_REQUIRED' })
      return
    }
    if (captcha === 'expired') {
      res.status(400).json({ error: 'AUTH_CAPTCHA_EXPIRED' })
      return
    }
    if (captcha !== 'ok') {
      res.status(400).json({ error: 'AUTH_CAPTCHA_INVALID' })
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
  }
)

// ALTCHA 挑战：登录页 widget 经 challenge 属性指向此地址取题（每次一题、带 HMAC 签名、
// 120s 有效）。出题本身只做随机数 + 一次 HMAC（不预计算派生键），限流防刷题耗内存。
authRouter.get(
  '/altcha-challenge',
  rateLimit({ windowMs: 60_000, max: 30 }),
  async (_req, res) => {
    try {
      const challenge = await issueChallenge()
      res.set('Cache-Control', 'no-store').json(challenge)
    } catch (e: any) {
      console.error('altcha challenge failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// 对应 login.php：原实现明文比对 bcrypt 哈希导致永远失败，这里修复为正确的 bcrypt 比对。
// 登录爆破防线：按 IP 每 5 分钟 20 次（bcrypt 慢哈希本身也是 CPU 消耗，超限直接 429）
authRouter.post('/login', rateLimit({ windowMs: 5 * 60_000, max: 20 }), async (req, res) => {
  try {
    const username = req.body?.username
    const password = req.body?.password
    const invalid = invalidCredentials(username, password)
    if (invalid) {
      res.status(400).json({ error: invalid.code })
      return
    }
    // ALTCHA PoW 验证（一次性）：验通过才进入口令比对；错口令也算消耗，
    // 下一次登录必须重解新题。机器码由前端按语言映射展示。
    const captcha = await verifyLoginCaptcha(req.body?.altcha)
    if (captcha === 'required') {
      res.status(400).json({ error: 'AUTH_CAPTCHA_REQUIRED' })
      return
    }
    if (captcha === 'expired') {
      res.status(400).json({ error: 'AUTH_CAPTCHA_EXPIRED' })
      return
    }
    if (captcha !== 'ok') {
      res.status(400).json({ error: 'AUTH_CAPTCHA_INVALID' })
      return
    }
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    const user = (rows as any[])[0]
    if (user && (await bcrypt.compare(password, user.password))) {
      // 重新生成会话 ID（防会话固定）：登录前持有的 sid 不延续到登录态
      req.session.regenerate((err: any) => {
        if (err) {
          console.error('session regenerate failed:', err)
          res.status(500).json({ error: 'SERVER_ERROR' })
          return
        }
        ;(req.session as any).username = username
        res.json({ success: true, username, isAdmin: isAdmin(req) })
      })
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

// 修改密码：需已登录 + 旧密码校验；新密码同样受最小长度与 72 字节上限约束。
// 旧密码试错防线：按 IP 每 10 分钟 10 次
authRouter.post(
  '/change-password',
  rateLimit({ windowMs: 10 * 60_000, max: 10 }),
  async (req, res) => {
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
  }
)

// WS 握手令牌：一次性、60 秒有效，把登录身份带过 9000 端口的 WebSocket 连接。
// 页面每次进聊天页都会换取一次，给到按 IP 每分钟 30 次的余量
authRouter.post('/ws-token', rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const username = sessionUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  res.json({ token: issueWsToken(username) })
})

// 管理员重置任意用户密码：找回密码的最小闭环——站点无邮件设施，
// 用户密码丢失时由管理员线下核实身份后重置（自己改密仍走 /change-password 验旧密码）。
authRouter.post(
  '/admin/reset-password',
  rateLimit({ windowMs: 10 * 60_000, max: 20 }),
  async (req, res) => {
    const admin = sessionUsername(req)
    if (!admin) {
      res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
      return
    }
    if (!isAdmin(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' })
      return
    }
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    if (!username || username.length > 255) {
      res.status(400).json({ error: 'AUTH_USERNAME_REQUIRED' })
      return
    }
    if (username === admin) {
      res.status(400).json({ error: 'AUTH_RESET_SELF' })
      return
    }
    const newPassword = req.body?.newPassword
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN) {
      res.status(400).json({ error: 'AUTH_PASSWORD_MIN', min: PASSWORD_MIN })
      return
    }
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      res.status(400).json({ error: 'AUTH_PASSWORD_TOO_LONG' })
      return
    }
    try {
      const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username])
      const user = (rows as any[])[0]
      if (!user) {
        res.status(404).json({ error: 'AUTH_USER_NOT_FOUND' })
        return
      }
      const hashed = await bcrypt.hash(newPassword, 10)
      await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id])
      console.log(`[admin] ${admin} 重置了用户 ${username} 的密码`)
      res.json({ success: true, username })
    } catch (e: any) {
      console.error('admin reset-password failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)
