import { Router } from 'express'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { issueWsToken } from '../wsTokens.js'
import { rateLimit } from '../rateLimit.js'
import { issueChallenge, verifyLoginCaptcha } from '../altcha.js'
import { AVATAR_DIR, AVATAR_NAME_RE, parseSocialLinks, type SocialLink } from './users.js'
import { IMAGE_DIR } from './blog.js'
import { UPLOAD_DIR as SHARE_DIR } from './share.js'

export const authRouter = Router()

// 注册新密码的最小长度（只约束新注册，不影响存量短密码用户登录）
const PASSWORD_MIN = 6

// ---------- 账号状态检查（禁用/注销治理） ----------

/** 会话用户当前是否仍是 active 用户；返回用户名或 null（行被删/被禁用/已注销） */
async function activeUsername(req: any): Promise<string | null> {
  const name = sessionUsername(req)
  if (!name) return null
  const [rows] = (await pool.query('SELECT status FROM users WHERE username = ?', [name])) as any[]
  const status = rows[0]?.status
  return status === 'active' ? name : null
}

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
    // 管理员封禁的账号明确告知；已注销账号密码已被打乱，走统一的凭证错误（不额外泄露状态）
    if (user?.status === 'disabled') {
      res.status(403).json({ error: 'AUTH_ACCOUNT_DISABLED' })
      return
    }
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

// 会话校验：客户端启动时据此同步登录态（session cookie 是唯一事实源）。
// 同时对账账号状态：被禁用/已注销的存量会话在此清除（管理员封禁后，用户下次刷新即被登出）
authRouter.get('/me', async (req, res) => {
  const username = (req.session as any).username
  if (typeof username === 'string' && username !== '') {
    try {
      const [rows] = (await pool.query('SELECT status FROM users WHERE username = ?', [username])) as any[]
      if (rows[0]?.status !== 'active') {
        req.session.destroy(() => {
          res.clearCookie('connect.sid').status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
        })
        return
      }
    } catch (e: any) {
      console.error('me status check failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
      return
    }
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
// 页面每次进聊天页都会换取一次，给到按 IP 每分钟 30 次的余量；
// 被禁用/注销账号的存量会话在此被拒（聊天身份与账号状态保持一致）
authRouter.post('/ws-token', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const username = await activeUsername(req)
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

// ---------- 个人主页：资料 / 隐私 / 头像 / 注销 ----------

// 编辑个人资料（登录）：昵称/简介/地区/社交链接。空串一律落 NULL（主页按空状态展示）
authRouter.put(
  '/profile',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 20,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
    const username = await activeUsername(req)
    if (!username) {
      res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
      return
    }
    const b = req.body ?? {}
    const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : ''
    const bio = typeof b.bio === 'string' ? b.bio.trim() : ''
    const region = typeof b.region === 'string' ? b.region.trim() : ''
    if (displayName.length > 40) {
      res.status(400).json({ error: 'PROFILE_DISPLAY_NAME_TOO_LONG' })
      return
    }
    if (bio.length > 500) {
      res.status(400).json({ error: 'PROFILE_BIO_TOO_LONG' })
      return
    }
    if (region.length > 60) {
      res.status(400).json({ error: 'PROFILE_REGION_TOO_LONG' })
      return
    }
    // 社交链接：≤5 条，label 1-30 字，url 须 http(s):// 开头且 ≤200 字（防 javascript: 注入）
    let social: SocialLink[] = []
    if (b.socialLinks !== undefined) {
      if (!Array.isArray(b.socialLinks)) {
        res.status(400).json({ error: 'PROFILE_SOCIAL_INVALID' })
        return
      }
      social = b.socialLinks.map((item: any) => ({
        label: typeof item?.label === 'string' ? item.label.trim() : '',
        url: typeof item?.url === 'string' ? item.url.trim() : '',
      }))
      if (social.length > 5) {
        res.status(400).json({ error: 'PROFILE_SOCIAL_INVALID' })
        return
      }
      for (const link of social) {
        if (
          !link.label ||
          link.label.length > 30 ||
          !/^https?:\/\//i.test(link.url) ||
          link.url.length > 200
        ) {
          res.status(400).json({ error: 'PROFILE_SOCIAL_INVALID' })
          return
        }
      }
      social = social.filter((l) => l.label && l.url)
    }
    try {
      await pool.query(
        'UPDATE users SET display_name = ?, bio = ?, region = ?, social_links = ? WHERE username = ?',
        [
          displayName || null,
          bio || null,
          region || null,
          social.length ? JSON.stringify(social) : null,
          username,
        ]
      )
      res.json({ success: true })
    } catch (e: any) {
      console.error('update profile failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// 隐私设置（登录）：主页公开位 / 各字段展示位 / 内容展示位 / 搜索引擎收录位，保存即生效
authRouter.put(
  '/privacy',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 30,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
    const username = await activeUsername(req)
    if (!username) {
      res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
      return
    }
    const b = req.body ?? {}
    const flags = [
      b.profilePublic,
      b.showRegion,
      b.showSocial,
      b.showContent,
      b.allowIndex,
    ]
    if (flags.some((v) => typeof v !== 'boolean')) {
      res.status(400).json({ error: 'PROFILE_PRIVACY_INVALID' })
      return
    }
    try {
      await pool.query(
        `UPDATE users SET
           is_profile_public = ?, show_region = ?, show_social = ?, show_content = ?, allow_index = ?
         WHERE username = ?`,
        [
          b.profilePublic ? 1 : 0,
          b.showRegion ? 1 : 0,
          b.showSocial ? 1 : 0,
          b.showContent ? 1 : 0,
          b.allowIndex ? 1 : 0,
          username,
        ]
      )
      res.json({ success: true })
    } catch (e: any) {
      console.error('update privacy failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// ---------- 用户图片上传（头像 / 壁纸共用） ----------
// 校验链与博客插图同款：multer 大小限制 → 声明 mime 白名单（SVG 一律拒绝）→ 扩展名一致
// → 魔数嗅探；通过后 sharp 重编码为 WebP 落 uploads/avatars/<32hex>.webp（与头像同目录同
// 命名规则），由 GET /api/users/avatars/:name 公开服务（文件名白名单 + immutable 长缓存）。
// 头像 → 256×256 居中裁切（AVATAR_MAX_MB 默认 2）；壁纸 → ≤1600×400 等比缩放（BANNER_MAX_MB
// 默认 4），条带呈现由前端 object-fit:cover 完成。GIF/WebP 保动画。
const AVATAR_MAX_MB = Number(process.env.AVATAR_MAX_MB) || 2
const BANNER_MAX_MB = Number(process.env.BANNER_MAX_MB) || 4
fs.mkdirSync(AVATAR_DIR, { recursive: true })

const USER_IMAGE_TYPES: Record<string, { exts: string[]; mimes: string[]; sniff: (b: Buffer) => boolean }> = {
  png: {
    exts: ['.png'], mimes: ['image/png'],
    sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  jpeg: {
    exts: ['.jpg', '.jpeg'], mimes: ['image/jpeg', 'image/pjpeg'],
    sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  gif: {
    exts: ['.gif'], mimes: ['image/gif'],
    sniff: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  },
  webp: {
    exts: ['.webp'], mimes: ['image/webp'],
    sniff: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  bmp: {
    exts: ['.bmp'], mimes: ['image/bmp', 'image/x-bmp'],
    sniff: (b) => b[0] === 0x42 && b[1] === 0x4d,
  },
}

function userImageSpecByMime(mime: string) {
  for (const spec of Object.values(USER_IMAGE_TYPES)) if (spec.mimes.includes(mime)) return spec
  return null
}

/** 声明 mime 白名单 → 扩展名一致 → 魔数嗅探；通过返回命中 spec，否则返回短错误码（调用方按头像/壁纸拼前缀） */
async function sniffUserImage(
  file: { path: string; mimetype?: string; originalname?: string }
): Promise<{ spec: (typeof USER_IMAGE_TYPES)[string] } | { error: 'INVALID_TYPE' | 'MALFORMED' }> {
  const declared = String(file.mimetype || '').toLowerCase()
  const spec = userImageSpecByMime(declared)
  if (!spec) return { error: 'INVALID_TYPE' }
  const rawExt = path.extname(file.originalname || '').toLowerCase()
  if (rawExt && !spec.exts.includes(rawExt)) return { error: 'INVALID_TYPE' }
  const fh = await fs.promises.open(file.path, 'r')
  try {
    const head = Buffer.alloc(16)
    await fh.read(head, 0, 16, 0)
    if (!spec.sniff(head)) return { error: 'MALFORMED' }
  } finally {
    await fh.close()
  }
  return { spec }
}

const userImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
})
function userImageUpload(maxMb: number) {
  return multer({ storage: userImageStorage, limits: { fileSize: maxMb * 1024 * 1024, files: 1 } })
}

// 重编码 + 落盘 + 清理临时文件的公共尾段：返回规范 webp 文件名（<32hex>.webp）
async function reencodeUserImage(
  tmpPath: string,
  spec: (typeof USER_IMAGE_TYPES)[string],
  resize: 256 | 'banner'
): Promise<string> {
  const animated = spec === USER_IMAGE_TYPES.gif || spec === USER_IMAGE_TYPES.webp
  const pipeline =
    resize === 256
      ? sharp(tmpPath, { animated }).resize(256, 256, { fit: 'cover', position: 'centre' })
      : sharp(tmpPath, { animated }).resize({
          width: 1600,
          height: 400,
          fit: 'inside',
          withoutEnlargement: true,
        })
  const buf = await pipeline.webp({ quality: resize === 256 ? 85 : 82 }).toBuffer()
  const name = crypto.randomBytes(16).toString('hex') + '.webp'
  await fs.promises.writeFile(path.join(AVATAR_DIR, name), buf)
  fs.promises.unlink(tmpPath).catch(() => {})
  return name
}

// 读取旧图名 → 更新列 → 回收旧文件（名字过白名单才动磁盘，杜绝路径穿越）
async function replaceUserImage(
  username: string,
  column: 'avatar' | 'banner',
  name: string
): Promise<void> {
  const [[row]] = (await pool.query(`SELECT id, ${column} AS old FROM users WHERE username = ?`, [
    username,
  ])) as any[]
  await pool.query(`UPDATE users SET ${column} = ? WHERE username = ?`, [name, username])
  if (row?.old && AVATAR_NAME_RE.test(String(row.old))) {
    fs.promises.unlink(path.join(AVATAR_DIR, String(row.old))).catch(() => {})
  }
}

// 头像上传（登录，限流 10/10min/用户）
authRouter.post(
  '/avatar',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 10,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  (req, res) => {
    userImageUpload(AVATAR_MAX_MB).single('file')(req, res, async (err) => {
      const fail = (status: number, payload: Record<string, unknown>) => {
        if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
        res.status(status).json(payload)
      }
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return fail(400, { error: 'AVATAR_TOO_LARGE', maxMb: AVATAR_MAX_MB })
        }
        console.error('avatar upload failed:', err)
        return fail(400, { error: 'AVATAR_UPLOAD_FAILED' })
      }
      try {
        const username = await activeUsername(req)
        if (!username) return fail(401, { error: 'AUTH_NOT_LOGGED_IN' })
        const file = req.file
        if (!file) return fail(400, { error: 'AVATAR_NO_FILE' })
        const sniffed = await sniffUserImage(file)
        if ('error' in sniffed) return fail(400, { error: `AVATAR_${sniffed.error}` })
        const name = await reencodeUserImage(file.path, sniffed.spec, 256)
        await replaceUserImage(username, 'avatar', name)
        res.json({ success: true, avatar: name })
      } catch (e: any) {
        console.error('avatar process failed:', e)
        if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
        res.status(500).json({ error: 'SERVER_ERROR' })
      }
    })
  }
)

// 删除头像（登录）：清空列并回收文件，主页回落默认首字头像
authRouter.delete('/avatar', async (req, res) => {
  const username = await activeUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  try {
    const [[row]] = (await pool.query('SELECT id, avatar FROM users WHERE username = ?', [
      username,
    ])) as any[]
    await pool.query('UPDATE users SET avatar = NULL WHERE username = ?', [username])
    if (row?.avatar && AVATAR_NAME_RE.test(String(row.avatar))) {
      fs.promises.unlink(path.join(AVATAR_DIR, String(row.avatar))).catch(() => {})
    }
    res.json({ success: true })
  } catch (e: any) {
    console.error('delete avatar failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 壁纸上传（登录，限流 10/10min/用户）：重编码为 ≤1600×400 等比 WebP，条带裁切交给前端
authRouter.post(
  '/banner',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 10,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  (req, res) => {
    userImageUpload(BANNER_MAX_MB).single('file')(req, res, async (err) => {
      const fail = (status: number, payload: Record<string, unknown>) => {
        if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
        res.status(status).json(payload)
      }
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return fail(400, { error: 'BANNER_TOO_LARGE', maxMb: BANNER_MAX_MB })
        }
        console.error('banner upload failed:', err)
        return fail(400, { error: 'BANNER_UPLOAD_FAILED' })
      }
      try {
        const username = await activeUsername(req)
        if (!username) return fail(401, { error: 'AUTH_NOT_LOGGED_IN' })
        const file = req.file
        if (!file) return fail(400, { error: 'BANNER_NO_FILE' })
        const sniffed = await sniffUserImage(file)
        if ('error' in sniffed) return fail(400, { error: `BANNER_${sniffed.error}` })
        const name = await reencodeUserImage(file.path, sniffed.spec, 'banner')
        await replaceUserImage(username, 'banner', name)
        res.json({ success: true, banner: name })
      } catch (e: any) {
        console.error('banner process failed:', e)
        if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
        res.status(500).json({ error: 'SERVER_ERROR' })
      }
    })
  }
)

// 删除壁纸（登录）：清空列并回收文件，主页回落无条带布局
authRouter.delete('/banner', async (req, res) => {
  const username = await activeUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  try {
    const [[row]] = (await pool.query('SELECT id, banner FROM users WHERE username = ?', [
      username,
    ])) as any[]
    await pool.query('UPDATE users SET banner = NULL WHERE username = ?', [username])
    if (row?.banner && AVATAR_NAME_RE.test(String(row.banner))) {
      fs.promises.unlink(path.join(AVATAR_DIR, String(row.banner))).catch(() => {})
    }
    res.json({ success: true })
  } catch (e: any) {
    console.error('delete banner failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 注销账号（登录）：需旧密码验证身份 + 输入用户名二次确认。
// 后果（确认文案如实告知）：其文章（连带文章下的评论/点赞）、其评论、其点赞、
// 其博客插图与分享文件全部删除；留言板留言与聊天日志属站点公开记录，保留不删。
// users 行保留但匿名化（status=deleted、密码打乱、资料清空）——保证历史引用不断裂。
authRouter.post(
  '/delete-account',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 5,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
    const username = await activeUsername(req)
    if (!username) {
      res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
      return
    }
    const password = req.body?.password
    const confirm = req.body?.confirm
    if (typeof password !== 'string' || password === '') {
      res.status(400).json({ error: 'AUTH_PASSWORD_REQUIRED' })
      return
    }
    if (confirm !== username) {
      res.status(400).json({ error: 'AUTH_DELETE_CONFIRM_MISMATCH' })
      return
    }
    try {
      const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
      const user = (rows as any[])[0]
      if (!user || !(await bcrypt.compare(password, user.password))) {
        res.status(401).json({ error: 'AUTH_OLD_PASSWORD_WRONG' })
        return
      }

      // 1) 自己的文章：连带各文章下的评论与点赞
      const [posts] = (await pool.query(
        'SELECT id, slug FROM blog_posts WHERE author_username = ?',
        [username]
      )) as any[]
      for (const post of posts as any[]) {
        if (post.slug) {
          await pool.query('DELETE FROM post_comments WHERE post_slug = ?', [post.slug])
          await pool.query('DELETE FROM post_likes WHERE post_slug = ?', [post.slug])
        }
      }
      await pool.query('DELETE FROM blog_posts WHERE author_username = ?', [username])
      // 2) 自己在他人文章下的评论与点赞
      await pool.query('DELETE FROM post_comments WHERE username = ?', [username])
      await pool.query('DELETE FROM post_likes WHERE username = ?', [username])
      // 3) 博客插图：删行 + 双文件（原图与展示变体）
      const [images] = (await pool.query(
        'SELECT id, stored_name, display_name FROM blog_images WHERE uploader_username = ?',
        [username]
      )) as any[]
      for (const img of images as any[]) {
        await pool.query('DELETE FROM blog_images WHERE id = ?', [img.id])
        fs.promises.unlink(path.join(IMAGE_DIR, path.basename(String(img.stored_name)))).catch(() => {})
        if (img.display_name) {
          fs.promises.unlink(path.join(IMAGE_DIR, path.basename(String(img.display_name)))).catch(() => {})
        }
      }
      // 4) 分享：删行 + 磁盘文件
      const [shares] = (await pool.query(
        'SELECT id, stored_name FROM share_items WHERE uploader_user = ?',
        [username]
      )) as any[]
      for (const item of shares as any[]) {
        await pool.query('DELETE FROM share_items WHERE id = ?', [item.id])
        if (item.stored_name) {
          fs.promises.unlink(path.join(SHARE_DIR, path.basename(String(item.stored_name)))).catch(() => {})
        }
      }
      // 5) 账号行匿名化：密码打乱（永远无法登录）、资料清空、头像/壁纸文件回收
      if (user.avatar && AVATAR_NAME_RE.test(String(user.avatar))) {
        fs.promises.unlink(path.join(AVATAR_DIR, String(user.avatar))).catch(() => {})
      }
      if (user.banner && AVATAR_NAME_RE.test(String(user.banner))) {
        fs.promises.unlink(path.join(AVATAR_DIR, String(user.banner))).catch(() => {})
      }
      const scrambled = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
      await pool.query(
        `UPDATE users SET status = 'deleted', password = ?, display_name = NULL, avatar = NULL,
           banner = NULL, bio = NULL, region = NULL, social_links = NULL WHERE id = ?`,
        [scrambled, user.id]
      )
      console.log(`[account] 用户 ${username} 已注销（内容已删除，账号行匿名化保留）`)
      req.session.destroy(() => {
        res.clearCookie('connect.sid').json({ success: true })
      })
    } catch (e: any) {
      console.error('delete-account failed:', e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)
