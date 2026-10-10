import { Router } from 'express'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { rateLimit } from '../rateLimit.js'

export const devlogRouter = Router()

// 对应 dev_log_fetch.php：按时间戳倒序
devlogRouter.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT timestamp, change_description FROM devLog ORDER BY timestamp DESC'
    )
    res.json(rows)
  } catch (e: any) {
    res.json({ error: e.message })
  }
})

// 对应 dev_log_submit.php：仅写入 change_description，时间戳由数据库生成
// 登录适配：写入改为管理员专属（登录 + ADMIN_USERNAMES 白名单），未登录 401 / 非管理员 403
devlogRouter.post('/', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  if (!sessionUsername(req)) {
    res.status(401).json({ error: 'LOGIN_REQUIRED' })
    return
  }
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'ADMIN_ONLY' })
    return
  }
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  if (!content || content.length > 5000) {
    res.status(400).json({ error: 'DEVLOG_INVALID' })
    return
  }
  try {
    await pool.query('INSERT INTO devLog (change_description) VALUES (?)', [content])
    res.json({ success: true })
  } catch (e: any) {
    res.json({ error: e.message })
  }
})
