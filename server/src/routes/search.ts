import { Router } from 'express'
import { pool } from '../db.js'
import { rateLimit } from '../rateLimit.js'
import { likePattern } from './admin.js'
import { readSearchScope } from '../searchConfig.js'

export const searchRouter = Router()

/**
 * 全站搜索（Ctrl+K 弹窗）：
 * GET /api/search?q= 关键词 —— 服务端按管理面板配置的模块开关，对 DB 内容做
 * 转义 LIKE 检索（用户博文含正文、博客评论、开发日志、留言板、用户主页），
 * 分组返回各模块的命中行；静态博文/题库/图表实验室/页面入口由客户端本地索引，
 * 不走本接口。隐私过滤全部在本端完成：草稿/隐藏留言不返回，
 * 用户仅 status=active 且 is_profile_public=1 且 allow_index=1（用户可自行关闭）。
 * 分享（取件码私密语义）与聊天记录不参与全站搜索。
 */

// 各模块命中行数上限：博客/日志信息量大放宽，其余走精简摘要
const LIMIT_POSTS = 8
const LIMIT_COMMENTS = 5
const LIMIT_DEVLOG = 8
const LIMIT_MESSAGES = 5
const LIMIT_USERS = 6

const DT_DATE = '%Y-%m-%d'
const DT_MIN = '%Y-%m-%d %H:%i'

// 模块开关下发（客户端本地模块据此过滤静态博文/题库/图表实验室/页面入口；
// 管理面板改动经此生效，60s 缓存平衡即时性与查询压力）
searchRouter.get('/config', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60')
  res.json({ modules: await readSearchScope() })
})

searchRouter.get('/', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  try {
    const q = String(req.query?.q ?? '').trim()
    if (!q || q.length > 100) {
      res.status(400).json({ error: 'SEARCH_QUERY_INVALID', max: 100 })
      return
    }
    const like = likePattern(q)!
    // LOCATE 做字面量子串定位（不识别通配符），须传原始关键词而非 LIKE 模式
    const needle = q.slice(0, 100)
    const scope = await readSearchScope()
    const out = {
      query: q,
      modules: scope,
      posts: [] as any[],
      comments: [] as any[],
      devlogs: [] as any[],
      messages: [] as any[],
      users: [] as any[],
    }
    const jobs: Promise<void>[] = []

    if (scope.posts) {
      jobs.push(
        pool
          .query(
            `SELECT slug, title, category, DATE_FORMAT(\`date\`, '${DT_DATE}') AS date,
               CASE WHEN title LIKE ? ESCAPE '\\\\' THEN excerpt
                 ELSE CONCAT('…', SUBSTRING(body, GREATEST(1, LOCATE(?, body) - 24), 72), '…') END AS snippet
             FROM blog_posts
             WHERE author_username IS NOT NULL AND is_published = 1
               AND (title LIKE ? ESCAPE '\\\\' OR excerpt LIKE ? ESCAPE '\\\\'
                 OR category LIKE ? ESCAPE '\\\\' OR tags LIKE ? ESCAPE '\\\\' OR body LIKE ? ESCAPE '\\\\')
             ORDER BY \`date\` DESC, id DESC
             LIMIT ${LIMIT_POSTS}`,
            [like, needle, like, like, like, like, like]
          )
          .then(([rows]) => {
            out.posts = rows as any[]
          })
      )
    }

    if (scope.comments) {
      jobs.push(
        pool
          .query(
            `SELECT pc.post_slug AS postSlug, pc.username,
               COALESCE(bp.title, pc.post_slug) AS postTitle,
               LEFT(pc.content, 100) AS snippet
             FROM post_comments pc
             LEFT JOIN blog_posts bp ON bp.slug = pc.post_slug
             WHERE (pc.content LIKE ? ESCAPE '\\\\' OR pc.username LIKE ? ESCAPE '\\\\')
               AND (bp.id IS NULL OR bp.is_published = 1)
             ORDER BY pc.id DESC
             LIMIT ${LIMIT_COMMENTS}`,
            [like, like]
          )
          .then(([rows]) => {
            out.comments = rows as any[]
          })
      )
    }

    if (scope.devlog) {
      jobs.push(
        pool
          .query(
            `SELECT DATE_FORMAT(timestamp, '${DT_MIN}') AS timestamp,
               LEFT(change_description, 120) AS description
             FROM devLog
             WHERE change_description LIKE ? ESCAPE '\\\\'
             ORDER BY id DESC
             LIMIT ${LIMIT_DEVLOG}`,
            [like]
          )
          .then(([rows]) => {
            out.devlogs = rows as any[]
          })
      )
    }

    if (scope.messages) {
      jobs.push(
        pool
          .query(
            `SELECT name, LEFT(message, 100) AS snippet,
               DATE_FORMAT(timestamp, '${DT_DATE}') AS timestamp
             FROM messages
             WHERE is_displayed = 1 AND (name LIKE ? ESCAPE '\\\\' OR message LIKE ? ESCAPE '\\\\')
             ORDER BY id DESC
             LIMIT ${LIMIT_MESSAGES}`,
            [like, like]
          )
          .then(([rows]) => {
            out.messages = rows as any[]
          })
      )
    }

    if (scope.users) {
      jobs.push(
        pool
          .query(
            `SELECT username, display_name AS displayName, LEFT(COALESCE(bio, ''), 80) AS bio
             FROM users
             WHERE status = 'active' AND is_profile_public = 1 AND allow_index = 1
               AND (username LIKE ? ESCAPE '\\\\' OR display_name LIKE ? ESCAPE '\\\\' OR bio LIKE ? ESCAPE '\\\\')
             ORDER BY created_at DESC
             LIMIT ${LIMIT_USERS}`,
            [like, like, like]
          )
          .then(([rows]) => {
            out.users = rows as any[]
          })
      )
    }

    await Promise.all(jobs)
    res.set('Cache-Control', 'no-store')
    res.json(out)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})
