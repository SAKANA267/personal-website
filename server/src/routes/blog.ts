import { Router, type Response } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { rateLimit } from '../rateLimit.js'

export const blogRouter = Router()

/**
 * 博客登录联动：登录用户撰写的文章存 blog_posts（author_username 非空、slug 以 u- 开头，
 * 与静态 .md 文章的文件名 slug 隔离）；评论/点赞按 slug 键控，静态文章同样可被评论点赞。
 * 字段别名与前端 BlogPost 逐字一致（read_time → readTime 等）。
 */

// ---------- 正文派生（excerpt / readTime 服务端计算） ----------

/** 剥离 Markdown 标记取纯文本（摘要与阅读时长共用）。 */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s*|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveExcerpt(body: string, max = 80): string {
  const text = stripMarkdown(body)
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

/** 阅读时长：中文按 ~400 字/分钟、英文单词按 ~200 词/分钟，至少 1 分钟。 */
function deriveReadTime(body: string): number {
  const text = stripMarkdown(body)
  const cjk = (text.match(/\p{Script=Han}/gu) || []).length
  const words = (text.replace(/\p{Script=Han}/gu, ' ').match(/[A-Za-z0-9]+/g) || []).length
  return Math.max(1, Math.round(cjk / 400 + words / 200))
}

// ---------- slug 生成（u- 前缀命名空间，避免与静态 .md 文件名撞车） ----------

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

async function makeSlug(title: string): Promise<string> {
  const base = 'u-' + (slugifyTitle(title) || 'post')
  const [rows] = (await pool.query('SELECT id FROM blog_posts WHERE slug = ?', [base])) as any[]
  if (!Array.isArray(rows) || rows.length === 0) return base
  // 撞车时追加时间戳后缀，实际不可能重复
  return `${base}-${Date.now().toString(36).slice(-4)}`
}

// ---------- 行归一化 ----------

function normalizeRow(row: any) {
  let tags: string[] = []
  if (Array.isArray(row.tags)) tags = row.tags
  else if (typeof row.tags === 'string' && row.tags) {
    try { tags = JSON.parse(row.tags) } catch { tags = [] }
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    date: row.date,
    category: row.category,
    tags,
    readTime: row.readTime ?? row.read_time ?? undefined,
    author: row.author ?? row.author_username ?? undefined,
    isPublished: row.isPublished ?? row.is_published ?? 1,
    body: row.body,
  }
}

const POST_FIELDS = `id, slug, title, excerpt,
  DATE_FORMAT(\`date\`, '%Y-%m-%d') AS date,
  category, tags, read_time AS readTime, author_username AS author,
  is_published AS isPublished`

// ---------- 文章 CRUD ----------

// 列表：用户文章（已发布 + 自己的草稿）。静态 .md 文章由前端打包期合并，不经此接口。
blogRouter.get('/', async (req, res) => {
  try {
    const user = sessionUsername(req)
    const [rows] = user
      ? await pool.query(
          `SELECT ${POST_FIELDS} FROM blog_posts
           WHERE author_username IS NOT NULL AND (is_published = 1 OR author_username = ?)
           ORDER BY \`date\` DESC, id DESC`,
          [user]
        )
      : await pool.query(
          `SELECT ${POST_FIELDS} FROM blog_posts
           WHERE author_username IS NOT NULL AND is_published = 1
           ORDER BY \`date\` DESC, id DESC`
        )
    res.json((rows as any[]).map(normalizeRow))
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 输入校验：标题/分类/标签/正文/发布位
function validatePostInput(body: any) {
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 120) return { error: 'POST_TITLE_INVALID' }
  const category =
    typeof body?.category === 'string' && body.category.trim() ? body.category.trim() : '随笔'
  if (category.length > 32) return { error: 'POST_CATEGORY_TOO_LONG' }
  let tags: string[] = []
  if (body?.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: 'POST_TAGS_INVALID' }
    tags = body.tags.map((t: any) => String(t).trim()).filter(Boolean)
    if (tags.length > 8) return { error: 'POST_TAGS_TOO_MANY' }
    if (tags.some((t) => t.length > 32)) return { error: 'POST_TAG_TOO_LONG' }
  }
  const content = typeof body?.body === 'string' ? body.body : ''
  if (!content.trim() || content.length > 50000) return { error: 'POST_BODY_INVALID' }
  const isPublished = body?.is_published === 0 ? 0 : 1
  return { title, category, tags, body: content, isPublished }
}

// 新建（登录）。按作者限流：每 10 分钟 10 篇，防脚本灌水
blogRouter.post(
  '/',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 10,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const v = validatePostInput(req.body)
    if ('error' in v) return res.status(400).json({ error: v.error })

    const slug = await makeSlug(v.title)
    const [result] = (await pool.query(
      `INSERT INTO blog_posts (slug, author_username, title, excerpt, \`date\`, category, tags, read_time, is_published, body)
       VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
      [slug, user, v.title, deriveExcerpt(v.body), v.category, JSON.stringify(v.tags), deriveReadTime(v.body), v.isPublished, v.body]
    )) as any

    const [rows] = (await pool.query(`SELECT ${POST_FIELDS}, body FROM blog_posts WHERE id = ?`, [
      result.insertId,
    ])) as any[]
    res.json({ success: true, post: normalizeRow(rows[0]) })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
  }
)

// ---------- 博客插图上传（登录用户，正文 Markdown 以 ![说明](/api/blog/images/<name>) 引用） ----------

const IMG_DIRNAME = path.dirname(fileURLToPath(import.meta.url))
// 插图落盘目录：server/uploads/blog（部署 tar 不覆盖运行时目录）
const IMAGE_DIR = path.resolve(IMG_DIRNAME, '../../uploads/blog')
fs.mkdirSync(IMAGE_DIR, { recursive: true })

// 单图大小上限，可用环境变量调整（生产 nginx 的 client_max_body_size 需同步）
const IMAGE_MAX_MB = Number(process.env.BLOG_IMAGE_MAX_MB) || 8
// 单用户插图存量上限（防磁盘无限膨胀；未引用图片由管理面板清理）
const IMAGE_USER_QUOTA = 500

// 展示变体：文章默认读压缩版（WebP，宽 ≤1600 / 高 ≤4000，不放大小），原图经 /original 查看。
// 小图（≤300KB 且尺寸未超限）不生成变体——压了没收益，直接读原图。
const DISPLAY_MAX_WIDTH = 1600
const DISPLAY_MAX_HEIGHT = 4000
const DISPLAY_MIN_BYTES = 300 * 1024
const DISPLAY_QUALITY = 82

interface ImageTypeSpec {
  ext: string // 落盘规范扩展名
  acceptExts: string[] // 允许的原始扩展名（jpeg/jpg 同义）
  mimes: string[] // 允许的声明 mime（首个为落库与输出 mime）
  sniff: (b: Buffer) => boolean // 魔数嗅探：实际内容须匹配
}

// 图片白名单（惰性位图）。SVG 可携带 <script>，内联输出即同源 XSS，
// 与分享站一致：上传侧拒绝、输出侧仅白名单 mime 可内联。
const IMAGE_TYPES: Record<string, ImageTypeSpec> = {
  png: {
    ext: '.png', acceptExts: ['.png'], mimes: ['image/png'],
    sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  jpeg: {
    ext: '.jpg', acceptExts: ['.jpg', '.jpeg'], mimes: ['image/jpeg', 'image/pjpeg'],
    sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  gif: {
    ext: '.gif', acceptExts: ['.gif'], mimes: ['image/gif'],
    sniff: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  },
  webp: {
    ext: '.webp', acceptExts: ['.webp'], mimes: ['image/webp'],
    sniff: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  bmp: {
    ext: '.bmp', acceptExts: ['.bmp'], mimes: ['image/bmp', 'image/x-bmp'],
    sniff: (b) => b[0] === 0x42 && b[1] === 0x4d,
  },
  avif: {
    ext: '.avif', acceptExts: ['.avif'], mimes: ['image/avif'],
    sniff: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && ['avif', 'avis'].includes(b.subarray(8, 12).toString('latin1')),
  },
}

function imageSpecByMime(mime: string): ImageTypeSpec | null {
  for (const spec of Object.values(IMAGE_TYPES)) if (spec.mimes.includes(mime)) return spec
  return null
}

// 磁盘/落库文件名格式：32 位 hex + 规范扩展名（读取/删除侧同一校验，杜绝路径穿越）
const IMAGE_NAME_RE = /^[0-9a-f]{32}\.(png|jpg|gif|webp|bmp|avif)$/

// multer 先落成无扩展名的随机名，校验通过后再 rename 成规范名（扩展名取决于嗅探结果）
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
  filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
})
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: IMAGE_MAX_MB * 1024 * 1024, files: 1 },
})

// 上传插图（登录）：multipart 字段 file。按用户限流每 10 分钟 20 张。
// 校验链：multer 大小限制 → 声明 mime 白名单 → 原始扩展名一致 → 存量配额 → 魔数嗅探。
// 全部通过才落库；任一环节失败即删除临时文件。
blogRouter.post(
  '/images',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 20,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  (req, res) => {
    imageUpload.single('file')(req, res, async (err) => {
      const fail = (status: number, payload: Record<string, unknown>) => {
        if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
        res.status(status).json(payload)
      }
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return fail(400, { error: 'BLOG_IMAGE_TOO_LARGE', maxMb: IMAGE_MAX_MB })
        }
        console.error('blog image upload failed:', err)
        return fail(400, { error: 'BLOG_IMAGE_UPLOAD_FAILED' })
      }
      try {
        const user = sessionUsername(req)
        if (!user) return fail(401, { error: 'LOGIN_REQUIRED' })
        const file = req.file
        if (!file) return fail(400, { error: 'BLOG_IMAGE_NO_FILE' })

        // 1) 声明 mime 须命中白名单（SVG/HTML/任意非图片类型在此被拒）
        const declared = String(file.mimetype || '').toLowerCase()
        const spec = imageSpecByMime(declared)
        if (!spec) return fail(400, { error: 'BLOG_IMAGE_INVALID_TYPE' })

        // 2) 原始扩展名（若有）须与声明类型一致，拦「exe 改名 png」类伪装
        const rawExt = path.extname(file.originalname || '').toLowerCase()
        if (rawExt && !spec.acceptExts.includes(rawExt)) {
          return fail(400, { error: 'BLOG_IMAGE_INVALID_TYPE' })
        }

        // 3) 存量配额
        const [[{ count }]] = (await pool.query(
          'SELECT COUNT(*) AS count FROM blog_images WHERE uploader_username = ?',
          [user]
        )) as any[]
        if (count >= IMAGE_USER_QUOTA) return fail(400, { error: 'BLOG_IMAGE_QUOTA_EXCEEDED' })

        // 4) 魔数嗅探：文件头须与声明类型匹配，拒绝内容与后缀不符的恶意文件
        const fh = await fs.promises.open(file.path, 'r')
        try {
          const head = Buffer.alloc(16)
          await fh.read(head, 0, 16, 0)
          if (!spec.sniff(head)) return fail(400, { error: 'BLOG_IMAGE_MALFORMED' })
        } finally {
          await fh.close()
        }

        // 校验全过：rename 成规范扩展名 → 生成展示变体 → 落库（DB 失败时清理已落盘文件）
        const hex = crypto.randomBytes(16).toString('hex')
        const name = hex + spec.ext
        const absOrig = path.join(IMAGE_DIR, name)
        await fs.promises.rename(file.path, absOrig)

        // 展示变体：GIF/WebP 输入带 animated 保动画；生成失败一律回退"仅原图"，不影响上传成功
        let displayName: string | null = null
        let displaySize: number | null = null
        try {
          const animated = ['image/gif', 'image/webp'].includes(spec.mimes[0])
          const meta = await sharp(absOrig, { animated }).metadata()
          const oversized =
            file.size > DISPLAY_MIN_BYTES ||
            (meta.width ?? 0) > DISPLAY_MAX_WIDTH ||
            (meta.height ?? 0) > DISPLAY_MAX_HEIGHT
          if (oversized && meta.width && meta.height) {
            const buf = await sharp(absOrig, { animated })
              .resize({ width: DISPLAY_MAX_WIDTH, height: DISPLAY_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: DISPLAY_QUALITY })
              .toBuffer()
            // 已高度优化的图重编码可能反而更大——比原图大就不留变体
            if (buf.length < file.size) {
              displayName = `${hex}.disp.webp`
              await fs.promises.writeFile(path.join(IMAGE_DIR, displayName), buf)
              displaySize = buf.length
            }
          }
        } catch (e) {
          console.warn('博客插图展示变体生成失败，仅存原图:', name, e)
          displayName = null
          displaySize = null
        }

        try {
          await pool.query(
            'INSERT INTO blog_images (stored_name, uploader_username, mime_type, size, display_name, display_mime, display_size) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, user, spec.mimes[0], file.size, displayName, displayName ? 'image/webp' : null, displaySize]
          )
        } catch (e) {
          fs.promises.unlink(absOrig).catch(() => {})
          if (displayName) fs.promises.unlink(path.join(IMAGE_DIR, displayName)).catch(() => {})
          throw e
        }
        res.json({ success: true, image: { name, url: `/api/blog/images/${name}`, mime: spec.mimes[0], size: file.size, displaySize } })
      } catch (e: any) {
        console.error(e)
        if (req.file) fs.promises.unlink(req.file.path).catch(() => {})
        res.status(500).json({ error: 'SERVER_ERROR' })
      }
    })
  }
)

// 读取辅助：按 want 取展示变体或原图。名字必须命中白名单格式且库内有登记行；
// Content-Type 只输出白名单 mime（配合全局 nosniff，即使库被手改也不会内联执行脚本）。
async function serveBlogImage(res: Response, rawName: unknown, want: 'display' | 'original') {
  const name = String(rawName)
  if (!IMAGE_NAME_RE.test(name)) {
    res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    return
  }
  const [[row]] = (await pool.query(
    'SELECT stored_name, mime_type, display_name, display_mime FROM blog_images WHERE stored_name = ?',
    [name]
  )) as any[]
  if (!row) {
    res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    return
  }
  const absOrig = path.join(IMAGE_DIR, path.basename(name))
  const hasOrig = fs.existsSync(absOrig)
  const absDisp = row.display_name ? path.join(IMAGE_DIR, path.basename(String(row.display_name))) : null
  const hasDisp = !!absDisp && fs.existsSync(absDisp)
  // 原图丢失：登记行已无意义，惰性清理（变体一并删除）
  if (!hasOrig) {
    await pool.query('DELETE FROM blog_images WHERE stored_name = ?', [name])
    if (absDisp && hasDisp) fs.promises.unlink(absDisp).catch(() => {})
    res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    return
  }
  const useDisp = want === 'display' && hasDisp
  const abs = useDisp ? absDisp! : absOrig
  const mime = Object.values(IMAGE_TYPES).some((s) =>
    s.mimes.includes(useDisp ? String(row.display_mime) : row.mime_type)
  )
    ? useDisp
      ? String(row.display_mime)
      : row.mime_type
    : 'application/octet-stream'
  res.sendFile(abs, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

// 读取插图（公开，不可变内容配长缓存）：默认返回压缩展示变体，无变体/变体丢失回退原图
blogRouter.get('/images/:name', async (req, res) => {
  try {
    await serveBlogImage(res, req.params.name, 'display')
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 原图字节（阅读页「查看原图」的目标）
blogRouter.get('/images/:name/original', async (req, res) => {
  try {
    await serveBlogImage(res, req.params.name, 'original')
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 元数据（阅读页徽标）：origSize = 原图字节数，dispSize = 展示变体字节数（null = 未压缩，读的就是原图）
blogRouter.get('/images/:name/meta', async (req, res) => {
  try {
    const name = String(req.params.name)
    if (!IMAGE_NAME_RE.test(name)) return res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    const [[row]] = (await pool.query(
      'SELECT size, display_size FROM blog_images WHERE stored_name = ?',
      [name]
    )) as any[]
    if (!row) return res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    res.json({ name, origSize: row.size, dispSize: row.display_size ?? null })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 删除插图（上传者本人或管理员）：撰写页取消已上传的图时调用，避免孤儿文件
blogRouter.delete('/images/:name', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const name = String(req.params.name)
    if (!IMAGE_NAME_RE.test(name)) return res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    const [[row]] = (await pool.query(
      'SELECT id, uploader_username, display_name FROM blog_images WHERE stored_name = ?',
      [name]
    )) as any[]
    if (!row) return res.status(404).json({ error: 'BLOG_IMAGE_NOT_FOUND' })
    if (row.uploader_username !== user && !isAdmin(req)) {
      return res.status(403).json({ error: 'BLOG_IMAGE_DELETE_FORBIDDEN' })
    }
    await pool.query('DELETE FROM blog_images WHERE id = ?', [row.id])
    fs.promises.unlink(path.join(IMAGE_DIR, path.basename(name))).catch(() => {})
    // 展示变体一并清理
    if (row.display_name) {
      fs.promises.unlink(path.join(IMAGE_DIR, path.basename(String(row.display_name)))).catch(() => {})
    }
    res.json({ success: true })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 单篇正文（发布，或作者本人/管理员可见草稿）
blogRouter.get('/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const [rows] = (await pool.query(
      `SELECT ${POST_FIELDS}, body FROM blog_posts WHERE slug = ? AND author_username IS NOT NULL`,
      [slug]
    )) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' })
    const post = normalizeRow(rows[0])
    if (post.isPublished !== 1) {
      const user = sessionUsername(req)
      if (user !== post.author && !isAdmin(req)) return res.status(404).json({ error: 'NOT_FOUND' })
    }
    res.json(post)
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 更新（作者本人或管理员；slug 不变）
blogRouter.put('/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const id = Number(req.params.id)
    const [rows] = (await pool.query(
      'SELECT id, author_username FROM blog_posts WHERE id = ? AND author_username IS NOT NULL',
      [id]
    )) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' })
    if (rows[0].author_username !== user && !isAdmin(req))
      return res.status(403).json({ error: 'NOT_ALLOWED' })

    const v = validatePostInput(req.body)
    if ('error' in v) return res.status(400).json({ error: v.error })

    await pool.query(
      `UPDATE blog_posts SET title = ?, category = ?, tags = ?, excerpt = ?, read_time = ?, is_published = ?, body = ?, updated_at = NOW()
       WHERE id = ?`,
      [v.title, v.category, JSON.stringify(v.tags), deriveExcerpt(v.body), deriveReadTime(v.body), v.isPublished, v.body, id]
    )
    const [after] = (await pool.query(`SELECT ${POST_FIELDS}, body FROM blog_posts WHERE id = ?`, [id])) as any[]
    res.json({ success: true, post: normalizeRow(after[0]) })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 删除（作者本人或管理员；级联删除评论与点赞）
blogRouter.delete('/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const id = Number(req.params.id)
    const [rows] = (await pool.query(
      'SELECT id, slug, author_username FROM blog_posts WHERE id = ? AND author_username IS NOT NULL',
      [id]
    )) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' })
    if (rows[0].author_username !== user && !isAdmin(req))
      return res.status(403).json({ error: 'NOT_ALLOWED' })

    const slug = rows[0].slug
    await pool.query('DELETE FROM post_comments WHERE post_slug = ?', [slug])
    await pool.query('DELETE FROM post_likes WHERE post_slug = ?', [slug])
    await pool.query('DELETE FROM blog_posts WHERE id = ?', [id])
    res.json({ success: true })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 评论 ----------

// 评论列表（公开，时间正序）
blogRouter.get('/:slug/comments', async (req, res) => {
  try {
    const [rows] = (await pool.query(
      `SELECT id, username, content, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS createdAt
       FROM post_comments WHERE post_slug = ? ORDER BY id ASC`,
      [String(req.params.slug)]
    )) as any[]
    res.json(rows)
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 发表评论（登录；静态/用户文章均可）。按作者每分钟 10 条
blogRouter.post(
  '/:slug/comments',
  rateLimit({
    windowMs: 60_000,
    max: 10,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const slug = String(req.params.slug)
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (!content || content.length > 2000) return res.status(400).json({ error: 'COMMENT_INVALID' })

    // 用户文章须存在且已发布（草稿不可被评论）；静态 .md 文章没有库行，直接放行
    const [posts] = (await pool.query(
      'SELECT slug, is_published, author_username FROM blog_posts WHERE slug = ?',
      [slug]
    )) as any[]
    if (Array.isArray(posts) && posts.length > 0 && posts[0].author_username && posts[0].is_published !== 1)
      return res.status(404).json({ error: 'NOT_FOUND' })

    const [result] = (await pool.query(
      'INSERT INTO post_comments (post_slug, username, content) VALUES (?, ?, ?)',
      [slug, user, content]
    )) as any
    const [rows] = (await pool.query(
      `SELECT id, username, content, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS createdAt
       FROM post_comments WHERE id = ?`,
      [result.insertId]
    )) as any[]
    res.json({ success: true, comment: rows[0] })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
  }
)

// 删除评论（评论者本人或管理员）
blogRouter.delete('/comments/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const id = Number(req.params.id)
    const [rows] = (await pool.query('SELECT id, username FROM post_comments WHERE id = ?', [id])) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' })
    if (rows[0].username !== user && !isAdmin(req))
      return res.status(403).json({ error: 'NOT_ALLOWED' })
    await pool.query('DELETE FROM post_comments WHERE id = ?', [id])
    res.json({ success: true })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 点赞 ----------

// 点赞状态（公开：总数 + 当前登录用户是否已赞）
blogRouter.get('/:slug/likes', async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const [[row]] = (await pool.query(
      'SELECT COUNT(*) AS count FROM post_likes WHERE post_slug = ?',
      [slug]
    )) as any[]
    const user = sessionUsername(req)
    let liked = false
    if (user) {
      const [[likeRow]] = (await pool.query(
        'SELECT id FROM post_likes WHERE post_slug = ? AND username = ?',
        [slug, user]
      )) as any[]
      liked = !!likeRow
    }
    res.json({ count: row?.count ?? 0, liked })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 点赞/取消（登录，toggle；一人一赞由 UNIQUE 约束保证）。
// 快速连续切换属正常操作，额度放宽到每分钟 30 次
blogRouter.post(
  '/:slug/likes',
  rateLimit({
    windowMs: 60_000,
    max: 30,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const slug = String(req.params.slug)

    const [existing] = (await pool.query(
      'SELECT id FROM post_likes WHERE post_slug = ? AND username = ?',
      [slug, user]
    )) as any[]
    if (Array.isArray(existing) && existing.length > 0) {
      await pool.query('DELETE FROM post_likes WHERE id = ?', [existing[0].id])
    } else {
      await pool.query('INSERT INTO post_likes (post_slug, username) VALUES (?, ?)', [slug, user])
    }

    const [[row]] = (await pool.query(
      'SELECT COUNT(*) AS count FROM post_likes WHERE post_slug = ?',
      [slug]
    )) as any[]
    res.json({ count: row?.count ?? 0, liked: !(existing && existing.length > 0) })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
  }
)
