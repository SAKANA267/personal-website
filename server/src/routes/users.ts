import { Router, type Request, type Response } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { POST_FIELDS, normalizeRow } from './blog.js'

/**
 * 个人主页（/api/users）：按用户名对外暴露主页资料、文章/评论列表与头像文件。
 *
 * 可见性规则（F-01/F-02/F-07）：
 * - 用户不存在 → 404 USER_NOT_FOUND；已注销 → 410 USER_DELETED；被禁用 → 403 USER_DISABLED；
 * - 主页私密（is_profile_public=0）且访问者非本人/管理员 → 403 PROFILE_PRIVATE；
 * - 公开主页按隐私开关裁剪字段：show_region / show_social 控制地区与社交链接是否下发，
 *   show_content 控制文章/评论列表（统计数字仍展示，只是聚合值）；
 * - 本人/管理员始终看到完整字段（含隐私开关本身，前端据此标「仅自己可见」）。
 */

export const usersRouter = Router()

// ---------- 社交链接（JSON 列）解析 ----------

export interface SocialLink {
  label: string
  url: string
}

/** mysql2 对 JSON 列通常已自动解析；容错字符串/数组异常形态，坏数据视作空 */
export function parseSocialLinks(raw: unknown): SocialLink[] {
  let val = raw
  if (typeof val === 'string' && val.trim()) {
    try { val = JSON.parse(val) } catch { return [] }
  }
  if (!Array.isArray(val)) return []
  return val
    .map((item: any) => ({
      label: typeof item?.label === 'string' ? item.label : '',
      url: typeof item?.url === 'string' ? item.url : '',
    }))
    .filter((l) => l.label && l.url)
}

// ---------- 查询辅助 ----------

interface UserRow {
  id: number
  username: string
  display_name: string | null
  avatar: string | null
  banner: string | null
  bio: string | null
  region: string | null
  social_links: unknown
  is_profile_public: number
  show_region: number
  show_social: number
  show_content: number
  allow_index: number
  status: 'active' | 'disabled' | 'deleted'
  created_at: string
}

/** 按用户名取完整用户行；不存在/已注销/被禁用分别以机器码应答（应答后返回 null） */
async function loadVisibleUser(req: Request, res: Response): Promise<UserRow | null> {
  const username = String(req.params.username ?? '')
  const [rows] = (await pool.query(
    `SELECT id, username, display_name, avatar, banner, bio, region, social_links,
       is_profile_public, show_region, show_social, show_content, allow_index, status,
       DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at
     FROM users WHERE username = ?`,
    [username]
  )) as any[]
  const user = rows[0] as UserRow | undefined
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' })
    return null
  }
  if (user.status === 'deleted') {
    res.status(410).json({ error: 'USER_DELETED' })
    return null
  }
  if (user.status === 'disabled') {
    res.status(403).json({ error: 'USER_DISABLED' })
    return null
  }
  return user
}

/** 本人或管理员 → 完整视野（隐藏字段照发 + 草稿可见） */
function isPrivileged(req: any, user: UserRow): boolean {
  const viewer = sessionUsername(req)
  return viewer === user.username || isAdmin(req)
}

// ---------- 主页资料 ----------

usersRouter.get('/:username/profile', async (req, res) => {
  try {
    const user = await loadVisibleUser(req, res)
    if (!user) return
    const privileged = isPrivileged(req, user)

    if (!privileged && user.is_profile_public !== 1) {
      res.status(403).json({ error: 'PROFILE_PRIVATE' })
      return
    }

    // 统计：文章数（他人=已发布，本人/管理员=含草稿）、评论数、获赞数（自己文章收到的赞）
    const showRegion = privileged || user.show_region === 1
    const showSocial = privileged || user.show_social === 1
    const [[stats]] = (await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM blog_posts bp WHERE bp.author_username = ?
            ${privileged ? '' : 'AND bp.is_published = 1'}) AS posts,
         (SELECT COUNT(*) FROM post_comments pc WHERE pc.username = ?) AS comments,
         (SELECT COUNT(*) FROM post_likes pl JOIN blog_posts bp ON pl.post_slug = bp.slug
            WHERE bp.author_username = ?) AS likesReceived`,
      [user.username, user.username, user.username]
    )) as any[]

    res.json({
      username: user.username,
      displayName: user.display_name ?? null,
      avatar: user.avatar ?? null,
      banner: user.banner ?? null,
      bio: user.bio ?? null,
      region: showRegion ? user.region ?? null : null,
      regionVisible: user.show_region === 1,
      socialLinks: showSocial ? parseSocialLinks(user.social_links) : [],
      socialVisible: user.show_social === 1,
      // 注册时间由 SQL 侧 DATE_FORMAT 定型（原 DATETIME 受时区序列化影响）
      createdAt: user.created_at,
      stats: {
        posts: stats?.posts ?? 0,
        comments: stats?.comments ?? 0,
        likes: stats?.likesReceived ?? 0,
      },
      contentVisible: privileged || user.show_content === 1,
      profilePublic: user.is_profile_public === 1,
      allowIndex: user.allow_index === 1,
      isSelf: sessionUsername(req) === user.username,
      isAdmin: !!sessionUsername(req) && isAdmin(req),
    })
  } catch (e: any) {
    console.error('profile failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 文章列表（主页「文章」标签） ----------

function parsePage(req: { query: any }, fallbackSize = 10): { limit: number; offset: number; page: number } {
  const page = Math.max(1, Number(req.query?.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query?.pageSize) || fallbackSize))
  return { limit, offset: (page - 1) * limit, page }
}

// 内容可见性共用门禁：私密主页 / 关闭内容展示时，列表接口对非本人/管理员关闭
function guardContent(req: any, res: any, user: UserRow): boolean {
  if (isPrivileged(req, user)) return true
  if (user.is_profile_public !== 1) {
    res.status(403).json({ error: 'PROFILE_PRIVATE' })
    return false
  }
  if (user.show_content !== 1) {
    res.status(403).json({ error: 'PROFILE_CONTENT_HIDDEN' })
    return false
  }
  return true
}

usersRouter.get('/:username/posts', async (req, res) => {
  try {
    const user = await loadVisibleUser(req, res)
    if (!user) return
    if (!guardContent(req, res, user)) return
    const privileged = isPrivileged(req, user)
    const { limit, offset, page } = parsePage(req)

    const [[{ total }]] = (await pool.query(
      `SELECT COUNT(*) AS total FROM blog_posts WHERE author_username = ?
         ${privileged ? '' : 'AND is_published = 1'}`,
      [user.username]
    )) as any[]
    const [rows] = (await pool.query(
      `SELECT ${POST_FIELDS} FROM blog_posts WHERE author_username = ?
         ${privileged ? '' : 'AND is_published = 1'}
       ORDER BY \`date\` DESC, id DESC LIMIT ? OFFSET ?`,
      [user.username, limit, offset]
    )) as any[]
    res.json({ rows: (rows as any[]).map(normalizeRow), total, page, pageSize: limit })
  } catch (e: any) {
    console.error('user posts failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 评论列表（主页「评论」标签） ----------

usersRouter.get('/:username/comments', async (req, res) => {
  try {
    const user = await loadVisibleUser(req, res)
    if (!user) return
    if (!guardContent(req, res, user)) return
    const { limit, offset, page } = parsePage(req)

    // LEFT JOIN：静态 .md 文章没有库行，标题回落取 slug
    const [[{ total }]] = (await pool.query(
      'SELECT COUNT(*) AS total FROM post_comments WHERE username = ?',
      [user.username]
    )) as any[]
    const [rows] = (await pool.query(
      `SELECT pc.id, pc.post_slug AS postSlug, pc.content,
         DATE_FORMAT(pc.created_at, '%Y-%m-%d %H:%i') AS createdAt,
         COALESCE(bp.title, pc.post_slug) AS postTitle
       FROM post_comments pc LEFT JOIN blog_posts bp ON bp.slug = pc.post_slug
       WHERE pc.username = ?
       ORDER BY pc.id DESC LIMIT ? OFFSET ?`,
      [user.username, limit, offset]
    )) as any[]
    res.json({ rows, total, page, pageSize: limit })
  } catch (e: any) {
    console.error('user comments failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 头像文件服务（注册在参数路由之后：/avatars/<name> 不与 /:username/posts 等冲突，
// 且用户名恰为 "avatars" 时其 /avatars/profile、/avatars/posts 仍优先命中上面的参数路由） ----------

// auth.ts 的头像上传/删除/注销清理共用同一目录与文件名白名单
export const AVATAR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../uploads/avatars'
)
// 头像一律由服务端重编码为 WebP（256×256），文件名格式即白名单，杜绝路径穿越
export const AVATAR_NAME_RE = /^[0-9a-f]{32}\.webp$/

usersRouter.get('/avatars/:name', async (req, res) => {
  try {
    const name = String(req.params.name)
    if (!AVATAR_NAME_RE.test(name)) {
      res.status(404).json({ error: 'AVATAR_NOT_FOUND' })
      return
    }
    const abs = path.join(AVATAR_DIR, name)
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: 'AVATAR_NOT_FOUND' })
      return
    }
    res.sendFile(abs, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (e: any) {
    console.error('avatar serve failed:', e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})
