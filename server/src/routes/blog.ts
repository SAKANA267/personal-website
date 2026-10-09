import { Router } from 'express'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'

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
    res.status(500).json({ error: e.message })
  }
})

// 输入校验：标题/分类/标签/正文/发布位
function validatePostInput(body: any) {
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 120) return { error: '标题须为 1-120 字' }
  const category =
    typeof body?.category === 'string' && body.category.trim() ? body.category.trim() : '随笔'
  if (category.length > 32) return { error: '分类过长（≤32 字）' }
  let tags: string[] = []
  if (body?.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: 'tags 须为数组' }
    tags = body.tags.map((t: any) => String(t).trim()).filter(Boolean)
    if (tags.length > 8) return { error: '标签最多 8 个' }
    if (tags.some((t) => t.length > 32)) return { error: '单个标签 ≤32 字' }
  }
  const content = typeof body?.body === 'string' ? body.body : ''
  if (!content.trim() || content.length > 50000) return { error: '正文须为 1-50000 字' }
  const isPublished = body?.is_published === 0 ? 0 : 1
  return { title, category, tags, body: content, isPublished }
}

// 新建（登录）
blogRouter.post('/', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'Login required' })
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
    res.status(500).json({ error: e.message })
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
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Not found' })
    const post = normalizeRow(rows[0])
    if (post.isPublished !== 1) {
      const user = sessionUsername(req)
      if (user !== post.author && !isAdmin(req)) return res.status(404).json({ error: 'Not found' })
    }
    res.json(post)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// 更新（作者本人或管理员；slug 不变）
blogRouter.put('/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'Login required' })
    const id = Number(req.params.id)
    const [rows] = (await pool.query(
      'SELECT id, author_username FROM blog_posts WHERE id = ? AND author_username IS NOT NULL',
      [id]
    )) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Not found' })
    if (rows[0].author_username !== user && !isAdmin(req))
      return res.status(403).json({ error: 'Not allowed' })

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
    res.status(500).json({ error: e.message })
  }
})

// 删除（作者本人或管理员；级联删除评论与点赞）
blogRouter.delete('/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'Login required' })
    const id = Number(req.params.id)
    const [rows] = (await pool.query(
      'SELECT id, slug, author_username FROM blog_posts WHERE id = ? AND author_username IS NOT NULL',
      [id]
    )) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Not found' })
    if (rows[0].author_username !== user && !isAdmin(req))
      return res.status(403).json({ error: 'Not allowed' })

    const slug = rows[0].slug
    await pool.query('DELETE FROM post_comments WHERE post_slug = ?', [slug])
    await pool.query('DELETE FROM post_likes WHERE post_slug = ?', [slug])
    await pool.query('DELETE FROM blog_posts WHERE id = ?', [id])
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
  }
})

// 发表评论（登录；静态/用户文章均可）
blogRouter.post('/:slug/comments', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'Login required' })
    const slug = String(req.params.slug)
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (!content || content.length > 2000) return res.status(400).json({ error: '评论须为 1-2000 字' })

    // 用户文章须存在且已发布（草稿不可被评论）；静态 .md 文章没有库行，直接放行
    const [posts] = (await pool.query(
      'SELECT slug, is_published, author_username FROM blog_posts WHERE slug = ?',
      [slug]
    )) as any[]
    if (Array.isArray(posts) && posts.length > 0 && posts[0].author_username && posts[0].is_published !== 1)
      return res.status(404).json({ error: 'Not found' })

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
    res.status(500).json({ error: e.message })
  }
})

// 删除评论（评论者本人或管理员）
blogRouter.delete('/comments/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'Login required' })
    const id = Number(req.params.id)
    const [rows] = (await pool.query('SELECT id, username FROM post_comments WHERE id = ?', [id])) as any[]
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Not found' })
    if (rows[0].username !== user && !isAdmin(req))
      return res.status(403).json({ error: 'Not allowed' })
    await pool.query('DELETE FROM post_comments WHERE id = ?', [id])
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
  }
})

// 点赞/取消（登录，toggle；一人一赞由 UNIQUE 约束保证）
blogRouter.post('/:slug/likes', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'Login required' })
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
    res.status(500).json({ error: e.message })
  }
})
