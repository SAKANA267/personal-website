import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'

export const authRouter = Router()

// 对应 sign_up.php：bcrypt 哈希后写入用户
authRouter.post('/signup', async (req, res) => {
  try {
    const username = req.body?.username
    const password = req.body?.password
    const hashed = await bcrypt.hash(password, 10)
    await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed])
    res.json({ success: true })
  } catch (e: any) {
    // 用户名唯一约束冲突 → 友好提示
    if (e.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Username already exists' })
    } else {
      res.status(500).json({ error: e.message })
    }
  }
})

// 对应 login.php：原实现明文比对 bcrypt 哈希导致永远失败，这里修复为正确的 bcrypt 比对
authRouter.post('/login', async (req, res) => {
  try {
    const username = req.body?.username
    const password = req.body?.password
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    const user = (rows as any[])[0]
    if (user && (await bcrypt.compare(password, user.password))) {
      ;(req.session as any).username = username
      res.json({ success: true, username })
    } else {
      res.status(401).json({ error: 'Invalid username or password' })
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})
