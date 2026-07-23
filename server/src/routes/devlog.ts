import { Router } from 'express'
import { pool } from '../db.js'

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
devlogRouter.post('/', async (req, res) => {
  try {
    const content = req.body?.content
    await pool.query('INSERT INTO devLog (change_description) VALUES (?)', [content])
    res.json({ success: true })
  } catch (e: any) {
    res.json({ error: e.message })
  }
})
