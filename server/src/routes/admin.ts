import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { rateLimit } from '../rateLimit.js'
import { readSearchScope, saveSearchScope, sanitizeSearchScope } from '../searchConfig.js'

export const adminRouter = Router()

/**
 * 管理面板 API（/api/admin）：把散落在各业务接口里的管理动作（留言审核、devlog 写入、
 * 博客/评论/分享管理删除、重置密码）收拢为一个统一入口，并提供全站概览与各资源的
 * 分页检索视图。所有接口统一过管理员白名单（未登录 401 / 非管理员 403），
 * 错误一律机器码（与站点其余接口一致）。
 *
 * 写操作复用既有业务接口：PATCH /api/messages/:id（留言隐藏/恢复）、POST /api/devlog、
 * DELETE /api/blog/:id、DELETE /api/blog/comments/:id、DELETE /api/share/:code、
 * POST /api/auth/admin/reset-password；本路由只补齐它们没有的能力
 * （概览聚合、全量分页列表、文章快速上下线、过期分享清理）。
 */

// ---------- 统一鉴权 ----------

adminRouter.use((req, res, next) => {
  if (!sessionUsername(req)) {
    res.status(401).json({ error: 'LOGIN_REQUIRED' })
    return
  }
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'ADMIN_ONLY' })
    return
  }
  next()
})

// ---------- 分页 / 搜索工具 ----------

const DT = '%Y-%m-%d %H:%i'

/** 解析 ?page=1&pageSize=20（pageSize 夹在 10-100） */
function parsePager(req: { query: any }): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number(req.query?.page) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(req.query?.pageSize) || 20))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** 关键词 → LIKE 模式（%_\\ 转义，配对 SQL 里的 ESCAPE '\\'）；导出供全站搜索路由复用 */
export function likePattern(q: unknown): string | null {
  if (typeof q !== 'string' || !q.trim()) return null
  const esc = q.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')
  return `%${esc}%`
}

/** 分页列表通用执行：where/order 动态拼接（参数化），返回 { rows, total, page, pageSize } */
async function pagedQuery(
  table: string,
  selectSql: string,
  whereSql: string,
  params: unknown[],
  pager: { page: number; pageSize: number; offset: number },
  orderSql: string
) {
  const [[{ total }]] = (await pool.query(
    `SELECT COUNT(*) AS total FROM ${table} ${whereSql}`,
    params
  )) as any[]
  const [rows] = (await pool.query(
    `${selectSql} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...params, pager.pageSize, pager.offset]
  )) as any[]
  return { rows, total, page: pager.page, pageSize: pager.pageSize }
}

// ---------- 概览（仪表盘单请求） ----------

adminRouter.get('/overview', async (_req, res) => {
  try {
    const [[counts]] = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM messages) AS messages,
        (SELECT COUNT(*) FROM messages WHERE is_displayed = 0) AS messagesHidden,
        (SELECT COUNT(*) FROM devLog) AS devlog,
        (SELECT COUNT(*) FROM blog_posts WHERE author_username IS NOT NULL) AS posts,
        (SELECT COUNT(*) FROM blog_posts WHERE author_username IS NOT NULL AND is_published = 0) AS postsDraft,
        (SELECT COUNT(*) FROM post_comments) AS comments,
        (SELECT COUNT(*) FROM post_likes) AS likes,
        (SELECT COUNT(*) FROM blog_images) AS blogImages,
        (SELECT COUNT(*) FROM share_items) AS shares,
        (SELECT COUNT(*) FROM share_items WHERE expires_at IS NULL OR expires_at > NOW()) AS sharesActive,
        (SELECT COUNT(*) FROM logs) AS logs,
        (SELECT MAX(timestamp) FROM messages) AS lastMessageAt
    `)) as any[]
    const [recentMessages, recentLogs] = await Promise.all([
      pool.query(
        `SELECT id, name, message, DATE_FORMAT(timestamp, '${DT}') AS timestamp, is_displayed
         FROM messages ORDER BY id DESC LIMIT 5`
      ),
      pool.query(
        `SELECT id, sender, message, DATE_FORMAT(timestamp, '${DT}') AS timestamp
         FROM logs ORDER BY id DESC LIMIT 5`
      ),
    ])
    res.json({
      counts,
      recentMessages: (recentMessages as any[])[0],
      recentLogs: (recentLogs as any[])[0],
      server: {
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
        now: new Date().toISOString(),
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 留言板（全量含已隐藏，供审核） ----------

adminRouter.get('/messages', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like ? 'WHERE name LIKE ? ESCAPE \'\\\\\' OR message LIKE ? ESCAPE \'\\\\\'' : ''
    const params = like ? [like, like] : []
    const data = await pagedQuery(
      'messages',
      `SELECT id, name, message, DATE_FORMAT(timestamp, '${DT}') AS timestamp, is_displayed FROM messages`,
      where,
      params,
      pager,
      'ORDER BY id DESC'
    )
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 开发日志（追加制，面板只读 + 走既有 POST 新增） ----------

adminRouter.get('/devlog', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like ? 'WHERE change_description LIKE ? ESCAPE \'\\\\\'' : ''
    const data = await pagedQuery(
      'devLog',
      `SELECT id, DATE_FORMAT(timestamp, '${DT}') AS timestamp, change_description FROM devLog`,
      where,
      like ? [like] : [],
      pager,
      'ORDER BY id DESC'
    )
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 博客文章（全量含草稿） ----------

adminRouter.get('/posts', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like
      ? `WHERE author_username IS NOT NULL AND (title LIKE ? ESCAPE '\\\\' OR author_username LIKE ? ESCAPE '\\\\')`
      : 'WHERE author_username IS NOT NULL'
    const params = like ? [like, like] : []
    const data = await pagedQuery(
      'blog_posts',
      `SELECT id, slug, title, author_username AS author, category,
         DATE_FORMAT(\`date\`, '%Y-%m-%d') AS date, is_published AS isPublished, read_time AS readTime,
         (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_slug = blog_posts.slug) AS commentCount,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_slug = blog_posts.slug) AS likeCount
       FROM blog_posts`,
      where,
      params,
      pager,
      'ORDER BY `date` DESC, id DESC'
    )
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 文章快速上下线：面板开关草稿位，不必走完整 PUT（无需重传正文）
adminRouter.patch(
  '/posts/:id/publish',
  rateLimit({ windowMs: 60_000, max: 60 }),
  async (req, res) => {
    try {
      const published = req.body?.is_published
      if (published !== 0 && published !== 1) {
        res.status(400).json({ error: 'POST_BAD_PUBLISHED' })
        return
      }
      const [result] = (await pool.query(
        'UPDATE blog_posts SET is_published = ?, updated_at = NOW() WHERE id = ? AND author_username IS NOT NULL',
        [published, req.params.id]
      )) as any
      if (result.affectedRows === 0) {
        res.status(404).json({ error: 'NOT_FOUND' })
        return
      }
      res.json({ success: true, isPublished: published })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// ---------- 评论（全站，跨文章检索） ----------

adminRouter.get('/comments', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like
      ? `WHERE username LIKE ? ESCAPE '\\\\' OR content LIKE ? ESCAPE '\\\\' OR post_slug LIKE ? ESCAPE '\\\\'`
      : ''
    const params = like ? [like, like, like] : []
    const data = await pagedQuery(
      'post_comments',
      `SELECT id, post_slug, username, content, DATE_FORMAT(created_at, '${DT}') AS createdAt FROM post_comments`,
      where,
      params,
      pager,
      'ORDER BY id DESC'
    )
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 分享（全量；text 正文不随列表下发，避免大字段拖慢） ----------

// 上传文件目录须与 share.ts 一致（清理时删除磁盘文件）
const UPLOAD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../uploads/share'
)

adminRouter.get('/shares', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like
      ? `WHERE title LIKE ? ESCAPE '\\\\' OR code LIKE ? ESCAPE '\\\\' OR uploader_user LIKE ? ESCAPE '\\\\'`
      : ''
    const params = like ? [like, like, like] : []
    const data = await pagedQuery(
      'share_items',
      `SELECT id, code, type, title, mime_type AS mimeType, size, views, downloads,
         uploader_user AS uploaderUser, uploader_ip AS uploaderIp,
         DATE_FORMAT(expires_at, '${DT}') AS expiresAt,
         DATE_FORMAT(created_at, '${DT}') AS createdAt,
         (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired
       FROM share_items`,
      where,
      params,
      pager,
      'ORDER BY id DESC'
    )
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 清理已过期分享：删行 + 清磁盘文件（与 share.ts 的惰性清理同一套逻辑）
adminRouter.post('/shares/cleanup', rateLimit({ windowMs: 60_000, max: 10 }), async (_req, res) => {
  try {
    const [rows] = (await pool.query(
      'SELECT id, stored_name FROM share_items WHERE expires_at IS NOT NULL AND expires_at <= NOW()'
    )) as any[]
    for (const item of rows as any[]) {
      if (item.stored_name) {
        const abs = path.join(UPLOAD_DIR, path.basename(String(item.stored_name)))
        fs.promises.unlink(abs).catch(() => {})
      }
      await pool.query('DELETE FROM share_items WHERE id = ?', [item.id])
    }
    res.json({ success: true, removed: (rows as any[]).length })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 博客插图（撰写页上传，正文引用） ----------

// 插图目录须与 blog.ts 一致（清理时删除磁盘文件）
const BLOG_IMAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../uploads/blog'
)

// 清理未被任何文章正文引用的插图（上传后取消插入 / 文章改稿删图留下的孤儿）。
// 引用判定：blog_posts.body 中出现 blog/images/<stored_name> 即视为在用（含草稿）。
adminRouter.post('/images/cleanup', rateLimit({ windowMs: 60_000, max: 10 }), async (_req, res) => {
  try {
    const [posts] = (await pool.query(
      'SELECT body FROM blog_posts WHERE body IS NOT NULL'
    )) as any[]
    const referenced = new Set<string>()
    const refRe = /blog\/images\/([0-9a-f]{32}\.(?:png|jpg|gif|webp|bmp|avif))/g
    for (const p of posts as any[]) {
      let m: RegExpExecArray | null
      while ((m = refRe.exec(String(p.body ?? '')))) referenced.add(m[1])
    }
    const [images] = (await pool.query('SELECT id, stored_name, display_name FROM blog_images')) as any[]
    let removed = 0
    for (const img of images as any[]) {
      if (referenced.has(img.stored_name)) continue
      await pool.query('DELETE FROM blog_images WHERE id = ?', [img.id])
      fs.promises.unlink(path.join(BLOG_IMAGE_DIR, path.basename(String(img.stored_name)))).catch(() => {})
      // 展示变体一并清理
      if (img.display_name) {
        fs.promises.unlink(path.join(BLOG_IMAGE_DIR, path.basename(String(img.display_name)))).catch(() => {})
      }
      removed += 1
    }
    res.json({ success: true, removed })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 用户（含各维度贡献计数与账号状态；注销由用户本人走 auth 侧） ----------

adminRouter.get('/users', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like ? 'WHERE username LIKE ? ESCAPE \'\\\\\'' : ''
    const params = like ? [like] : []
    const data = await pagedQuery(
      'users',
      `SELECT id, username, status, display_name AS displayName,
         DATE_FORMAT(created_at, '%Y-%m-%d') AS createdAt,
         (SELECT COUNT(*) FROM blog_posts bp WHERE bp.author_username = users.username) AS posts,
         (SELECT COUNT(*) FROM post_comments pc WHERE pc.username = users.username) AS comments,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.username = users.username) AS likes,
         (SELECT COUNT(*) FROM share_items si WHERE si.uploader_user = users.username) AS shares
       FROM users`,
      where,
      params,
      pager,
      'ORDER BY id DESC'
    )
    res.json(data)
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 禁用/启用账号：被禁用账号无法登录，存量会话在下次 /api/auth/me 对账或 ws-token 签发时失效。
// 白名单管理员（含操作者自己）不可被禁用——防止把唯一的治理入口锁死；deleted 只能由用户本人注销产生。
adminRouter.patch(
  '/users/:id/status',
  rateLimit({ windowMs: 60_000, max: 30 }),
  async (req, res) => {
    try {
      const status = req.body?.status
      if (status !== 'active' && status !== 'disabled') {
        res.status(400).json({ error: 'USER_STATUS_INVALID' })
        return
      }
      const [rows] = (await pool.query('SELECT id, username FROM users WHERE id = ?', [
        req.params.id,
      ])) as any[]
      const target = (rows as any[])[0]
      if (!target) {
        res.status(404).json({ error: 'USER_NOT_FOUND' })
        return
      }
      const whitelist = (process.env.ADMIN_USERNAMES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (whitelist.includes(target.username)) {
        res.status(400).json({ error: 'USER_ADMIN_PROTECTED' })
        return
      }
      await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, target.id])
      console.log(`[admin] ${sessionUsername(req)} 将用户 ${target.username} 置为 ${status}`)
      res.json({ success: true, username: target.username, status })
    } catch (e: any) {
      console.error(e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// ---------- 聊天日志（ws 服务写入的连接/发言记录） ----------

adminRouter.get('/logs', async (req, res) => {
  try {
    const pager = parsePager(req)
    const like = likePattern(req.query?.q)
    const where = like ? 'WHERE sender LIKE ? ESCAPE \'\\\\\' OR message LIKE ? ESCAPE \'\\\\\'' : ''
    const params = like ? [like, like] : []
    const data = await pagedQuery(
      'logs',
      `SELECT id, sender, message, DATE_FORMAT(timestamp, '${DT}') AS timestamp FROM logs`,
      where,
      params,
      pager,
      'ORDER BY id DESC'
    )
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 全站搜索设置（模块开关软编码；公开读走 /api/search/config） ----------

adminRouter.get('/search-config', async (_req, res) => {
  try {
    // 管理面板要即时生效的值，绕过公开 config 的 60s 缓存
    res.set('Cache-Control', 'no-store')
    res.json({ modules: await readSearchScope() })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

adminRouter.put(
  '/search-config',
  rateLimit({ windowMs: 60_000, max: 30 }),
  async (req, res) => {
    try {
      const scope = sanitizeSearchScope(req.body?.modules)
      if (!scope) {
        res.status(400).json({ error: 'SEARCH_CONFIG_INVALID' })
        return
      }
      await saveSearchScope(scope)
      console.log(`[admin] ${sessionUsername(req)} 更新搜索模块开关: ${JSON.stringify(scope)}`)
      res.json({ success: true, modules: scope })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)
