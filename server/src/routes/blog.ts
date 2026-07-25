import { Router } from 'express'
import { pool } from '../db.js'

export const blogRouter = Router()

// 对应前端 api.getBlogPosts()：文章列表，按日期倒序
// 字段名须与前端 BlogPost 逐字一致（read_time → readTime 别名）
blogRouter.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, excerpt,
              DATE_FORMAT(\`date\`, '%Y-%m-%d') AS date,
              category, tags, read_time AS readTime
       FROM blog_posts
       WHERE is_published = 1
       ORDER BY \`date\` DESC, id DESC`
    )
    res.json(rows)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})
