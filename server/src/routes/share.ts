import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { rateLimit } from '../rateLimit.js'

export const shareRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 上传文件落盘目录：server/uploads/share（部署 tar 不覆盖运行时目录）
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/share')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// 单文件大小上限，可通过环境变量调整（生产 nginx 的 client_max_body_size 需同步）
const MAX_MB = Number(process.env.SHARE_MAX_MB) || 20

// 上传时可选的有效期；缺省/无法识别 → 永久（expires_at 为 NULL）
const EXPIRY_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

// 取件码字符集：去掉 0/O/1/I 等易混字符
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // 磁盘文件名用随机十六进制，原始文件名只存数据库
    const rawExt = path.extname(file.originalname || '').slice(0, 16)
    const ext = rawExt.replace(/[^a-zA-Z0-9.]/g, '')
    cb(null, crypto.randomBytes(16).toString('hex') + ext)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
})

function expiryDate(expiresIn: unknown): Date | null {
  if (typeof expiresIn !== 'string') return null
  const ms = EXPIRY_MS[expiresIn]
  return ms ? new Date(Date.now() + ms) : null
}

function textTitle(content: string): string {
  const firstLine = String(content).split('\n').map((s) => s.trim()).find(Boolean) || '文字分享'
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
}

function generateCode(len = 6): string {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

async function createUniqueCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateCode()
    const [rows] = await pool.query('SELECT id FROM share_items WHERE code = ?', [code])
    if ((rows as any[]).length === 0) return code
  }
  throw new Error('取件码生成失败，请重试')
}

// 行数据 → 对外元数据（与前端 ShareItem 字段一一对应）
function toMeta(item: any) {
  return {
    code: item.code,
    type: item.type,
    title: item.title,
    mimeType: item.mime_type,
    size: item.size,
    content: item.type === 'text' ? item.content : null,
    createdAt: item.created_at,
    expiresAt: item.expires_at,
    views: item.views,
    downloads: item.downloads,
  }
}

// 删除一条分享：清理磁盘文件（可能已不存在，忽略报错）+ 删除行
async function deleteShareItem(item: any): Promise<void> {
  if (item.stored_name) {
    const abs = path.join(UPLOAD_DIR, path.basename(String(item.stored_name)))
    fs.promises.unlink(abs).catch(() => {})
  }
  await pool.query('DELETE FROM share_items WHERE id = ?', [item.id])
}

// 按取件码查有效分享；不存在返回 null，已过期则惰性清理后返回 'expired'
async function findActiveShare(code: string): Promise<any | null | 'expired'> {
  const [rows] = await pool.query('SELECT * FROM share_items WHERE code = ?', [code])
  const item = (rows as any[])[0]
  if (!item) return null
  if (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()) {
    await deleteShareItem(item)
    return 'expired'
  }
  return item
}

// 文字分享：JSON 正文（受全局 express.json 1mb 限制）。
// 游客可写，按 IP 每分钟 10 条防灌水
shareRouter.post('/text', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    if (!content.trim()) return res.status(400).json({ error: 'SHARE_TEXT_EMPTY' })
    if (content.length > 500_000) return res.status(400).json({ error: 'SHARE_TEXT_TOO_LONG' })

    const code = await createUniqueCode()
    const expiresAt = expiryDate(req.body?.expiresIn)
    // 登录适配：登录用户的分享记录归属（uploader_user），游客保持 NULL
    const uploader = sessionUsername(req)
    await pool.query(
      'INSERT INTO share_items (code, type, title, content, uploader_ip, uploader_user, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code, 'text', textTitle(content), content, req.ip, uploader, expiresAt]
    )
    const [rows] = await pool.query('SELECT * FROM share_items WHERE code = ?', [code])
    res.json({ success: true, item: toMeta((rows as any[])[0]) })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 图片/文件分享：multipart 上传（字段名 file）。
// 上传最耗磁盘与带宽，按 IP 每分钟 6 次收紧
shareRouter.post('/file', rateLimit({ windowMs: 60_000, max: 6 }), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'SHARE_FILE_TOO_LARGE', maxMb: MAX_MB })
      }
      console.error('share upload failed:', err)
      return res.status(400).json({ error: 'SHARE_UPLOAD_FAILED' })
    }
    try {
      const file = req.file
      if (!file) return res.status(400).json({ error: 'SHARE_NO_FILE' })
      const kind = req.body?.kind === 'image' ? 'image' : 'file'
      if (kind === 'image' && !file.mimetype.startsWith('image/')) {
        fs.promises.unlink(file.path).catch(() => {})
        return res.status(400).json({ error: 'SHARE_NOT_IMAGE' })
      }

      const code = await createUniqueCode()
      const expiresAt = expiryDate(req.body?.expiresIn)
      // 登录适配：登录用户的分享记录归属（uploader_user），游客保持 NULL
      const uploader = sessionUsername(req)
      await pool.query(
        'INSERT INTO share_items (code, type, title, stored_name, mime_type, size, uploader_ip, uploader_user, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [code, kind, file.originalname || '未命名文件', file.filename, file.mimetype, file.size, req.ip, uploader, expiresAt]
      )
      const [rows] = await pool.query('SELECT * FROM share_items WHERE code = ?', [code])
      res.json({ success: true, item: toMeta((rows as any[])[0]) })
    } catch (e: any) {
      // DB 写入失败时清理已落盘的文件，避免孤儿文件
      if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
      console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
    }
  })
})

// 登录适配：我的分享列表（仅本人，按创建倒序）。
// 注意必须注册在 GET /:code 之前，否则 "mine" 会被当成取件码。
shareRouter.get('/mine', async (req, res) => {
  const username = sessionUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  try {
    const [rows] = await pool.query(
      'SELECT * FROM share_items WHERE uploader_user = ? ORDER BY id DESC',
      [username]
    )
    res.json((rows as any[]).map(toMeta))
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 登录适配：删除自己的分享（管理员可删任意），同时清理磁盘文件
shareRouter.delete('/:code', async (req, res) => {
  const username = sessionUsername(req)
  if (!username) {
    res.status(401).json({ error: 'AUTH_NOT_LOGGED_IN' })
    return
  }
  try {
    const [rows] = await pool.query('SELECT * FROM share_items WHERE code = ?', [req.params.code])
    const item = (rows as any[])[0]
    if (!item) {
      res.status(404).json({ error: 'SHARE_NOT_FOUND' })
      return
    }
    if (item.uploader_user !== username && !isAdmin(req)) {
      res.status(403).json({ error: 'SHARE_DELETE_FORBIDDEN' })
      return
    }
    await deleteShareItem(item)
    res.json({ success: true })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 取件元数据：文字类型附带正文；已过期 → 410 并惰性清理
shareRouter.get('/:code', async (req, res) => {
  try {
    const item = await findActiveShare(req.params.code)
    if (item === null) return res.status(404).json({ error: 'SHARE_NOT_FOUND' })
    if (item === 'expired') return res.status(410).json({ error: 'SHARE_EXPIRED' })
    await pool.query('UPDATE share_items SET views = views + 1 WHERE id = ?', [item.id])
    res.json(toMeta(item))
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 文件内联输出：仅允许图片（其余类型一律走下载，防 HTML/SVG 内联 XSS）
shareRouter.get('/:code/file', async (req, res) => {
  try {
    const item = await findActiveShare(req.params.code)
    if (item === null) return res.status(404).json({ error: 'SHARE_NOT_FOUND' })
    if (item === 'expired') return res.status(410).json({ error: 'SHARE_EXPIRED' })
    if (item.type !== 'image' || !item.stored_name) {
      return res.status(400).json({ error: 'SHARE_NO_PREVIEW' })
    }
    const abs = path.join(UPLOAD_DIR, path.basename(String(item.stored_name)))
    if (!fs.existsSync(abs)) {
      await deleteShareItem(item)
      return res.status(404).json({ error: 'SHARE_FILE_GONE' })
    }
    res.sendFile(abs, {
      headers: {
        'Content-Type': item.mime_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.title)}`,
      },
    })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 下载：attachment 输出并计数；文字类型输出 .txt
shareRouter.get('/:code/download', async (req, res) => {
  try {
    const item = await findActiveShare(req.params.code)
    if (item === null) return res.status(404).json({ error: 'SHARE_NOT_FOUND' })
    if (item === 'expired') return res.status(410).json({ error: 'SHARE_EXPIRED' })

    await pool.query('UPDATE share_items SET downloads = downloads + 1 WHERE id = ?', [item.id])

    if (item.type === 'text') {
      res.attachment(`${item.title}.txt`)
      return res.type('text/plain; charset=utf-8').send(item.content)
    }
    if (!item.stored_name) return res.status(404).json({ error: 'SHARE_FILE_GONE' })
    const abs = path.join(UPLOAD_DIR, path.basename(String(item.stored_name)))
    if (!fs.existsSync(abs)) {
      await deleteShareItem(item)
      return res.status(404).json({ error: 'SHARE_FILE_GONE' })
    }
    res.download(abs, item.title)
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})
