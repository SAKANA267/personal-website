import { Router } from 'express'
import { pool } from '../db.js'
import { sessionUsername, isAdmin } from '../admin.js'
import { rateLimit } from '../rateLimit.js'

export const messagesRouter = Router()

// 对应 fetch_messages.php：普通访客仅返回 is_displayed=1 的留言，按 id 倒序；
// 登录适配：管理员可看到全部（含已隐藏），并附带 is_displayed 供审核界面切换。
// ?limit=N 控制单次拉取条数（1-1000，缺省 500）：留言只增不减，防止全量拉取拖垮首屏
function parseLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return 500
  return Math.min(n, 1000)
}
messagesRouter.get('/', async (req, res) => {
  const limit = parseLimit(req.query?.limit)
  try {
    const [rows] = isAdmin(req)
      ? await pool.query(
          'SELECT `id`, `name`, `message`, `timestamp`, `is_displayed` FROM messages ORDER BY `id` DESC LIMIT ?',
          [limit]
        )
      : await pool.query(
          'SELECT `name`, `message`, `timestamp` FROM messages WHERE `is_displayed` = 1 ORDER BY `id` DESC LIMIT ?',
          [limit]
        )
    res.json(rows)
  } catch (e: any) {
    res.json({ error: e.message })
  }
})

// 对应 submit_message.php：插入留言，时间戳为当前时间，is_displayed 走默认值 1。
// 留言板是游客可写的最暴露入口，按 IP 每分钟 5 条防刷屏
// 输入校验：非空 + 长度上限（此前 undefined 会直接让 mysql2 抛错，超长串打 DB 报错）
const NAME_MAX = 100
const MESSAGE_MAX = 5000
messagesRouter.post('/', rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'MESSAGE_NAME_REQUIRED' })
    return
  }
  if (name.length > NAME_MAX) {
    res.status(400).json({ error: 'MESSAGE_NAME_TOO_LONG', max: NAME_MAX })
    return
  }
  if (!message) {
    res.status(400).json({ error: 'MESSAGE_TEXT_REQUIRED' })
    return
  }
  if (message.length > MESSAGE_MAX) {
    res.status(400).json({ error: 'MESSAGE_TEXT_TOO_LONG', max: MESSAGE_MAX })
    return
  }
  try {
    await pool.query('INSERT INTO messages (name, message, timestamp) VALUES (?, ?, NOW())', [
      name,
      message,
    ])
    res.json({ success: true })
  } catch (e: any) {
    res.json({ error: e.message })
  }
})

// 登录适配：留言审核——管理员隐藏/恢复一条留言（is_displayed 置 0/1）。
// 批量审核会连续切换，按 IP 每分钟 60 次的宽裕额度
messagesRouter.patch('/:id', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  if (!sessionUsername(req)) {
    res.status(401).json({ error: 'LOGIN_REQUIRED' })
    return
  }
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'ADMIN_ONLY' })
    return
  }
  const displayed = req.body?.is_displayed
  if (displayed !== 0 && displayed !== 1) {
    res.status(400).json({ error: 'MESSAGE_BAD_DISPLAYED' })
    return
  }
  try {
    const [result] = await pool.query('UPDATE messages SET is_displayed = ? WHERE id = ?', [
      displayed,
      req.params.id,
    ])
    if ((result as any).affectedRows === 0) {
      res.status(404).json({ error: 'MESSAGE_NOT_FOUND' })
      return
    }
    res.json({ success: true })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ error: 'SERVER_ERROR' })
  }
})
