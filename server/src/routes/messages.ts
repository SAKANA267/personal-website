import { Router } from 'express'
import { pool } from '../db.js'

export const messagesRouter = Router()

// 对应 fetch_messages.php：仅返回 is_displayed=1 的留言，按 id 倒序
messagesRouter.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT `name`, `message`, `timestamp` FROM messages WHERE `is_displayed` = 1 ORDER BY `id` DESC'
    )
    res.json(rows)
  } catch (e: any) {
    res.json({ error: e.message })
  }
})

// 对应 submit_message.php：插入留言，时间戳为当前时间，is_displayed 走默认值 1
messagesRouter.post('/', async (req, res) => {
  try {
    const name = req.body?.name
    const message = req.body?.message
    await pool.query(
      'INSERT INTO messages (name, message, timestamp) VALUES (?, ?, NOW())',
      [name, message]
    )
    res.json({ success: true })
  } catch (e: any) {
    res.json({ error: e.message })
  }
})
