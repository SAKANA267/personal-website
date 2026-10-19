import { Router } from 'express'
import { pool } from '../db.js'
import { sessionUsername } from '../admin.js'
import { rateLimit } from '../rateLimit.js'

export const trackingRouter = Router()

/**
 * 数值追踪：登录用户创建多个数值项目（体重/学习时长/里程…），逐点录入数值，
 * 客户端在同一张折线图里统一对比。数据严格私有——所有端点要求登录，
 * 所有权按 owner_username 判定（不设管理员后门，管理面板亦无入口）。
 *
 * recorded_at 由客户端以本地时间字符串提供，原样存储不换算时区，
 * 读回时同样以 'YYYY-MM-DDTHH:mm:ss' 无时区标记返回，客户端按本地时间解析，往返稳定。
 */

// ---------- 上限 ----------

// 单用户项目数上限（灰阶/色板容量也在此量级，防止无限建项）
const PROJECT_USER_LIMIT = 50
// 单项目数据点上限
const POINT_PROJECT_LIMIT = 10000
// DECIMAL(15,4) 的安全绝对值上限（11 位整数）
const VALUE_ABS_MAX = 1e11

// ---------- 校验 ----------

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

// 项目字段：name 1-40 / unit 0-20 / description 0-200 / color 空或 #rrggbb
function validateProjectInput(body: any) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 40) return { error: 'TRACKING_NAME_INVALID' }
  const unit = typeof body?.unit === 'string' ? body.unit.trim() : ''
  if (unit.length > 20) return { error: 'TRACKING_UNIT_INVALID' }
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (description.length > 200) return { error: 'TRACKING_DESC_INVALID' }
  let color: string | null = null
  if (body?.color !== undefined && body?.color !== null && body?.color !== '') {
    if (typeof body.color !== 'string' || !COLOR_RE.test(body.color)) {
      return { error: 'TRACKING_COLOR_INVALID' }
    }
    color = body.color.toLowerCase()
  }
  return { name, unit, description, color }
}

// 时间点：'YYYY-MM-DD[ T]HH:mm[:ss]'，须是真实存在的日期时间；空 = 落库时取 NOW()
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
type ParsedDate = string | null | { error: 'TRACKING_DATE_INVALID' }
function parseRecordedAt(raw: unknown): ParsedDate {
  if (raw === undefined || raw === null || raw === '') return null // 交给 SQL 的 IFNULL(?, NOW())
  if (typeof raw !== 'string') return { error: 'TRACKING_DATE_INVALID' }
  const m = DATE_RE.exec(raw.trim())
  if (!m) return { error: 'TRACKING_DATE_INVALID' }
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (
    dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d) ||
    dt.getHours() !== Number(h) || dt.getMinutes() !== Number(mi) || dt.getSeconds() !== Number(s)
  ) {
    return { error: 'TRACKING_DATE_INVALID' }
  }
  // 统一成 MySQL 的空格分隔形式
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

function isDateError(x: ParsedDate): x is { error: 'TRACKING_DATE_INVALID' } {
  return typeof x === 'object' && x !== null
}

// 数据点字段：value 有限数且 |v| < 1e11（4 位小数内舍入）/ note 0-200
function validatePointInput(body: any) {
  const v = body?.value
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) >= VALUE_ABS_MAX) {
    return { error: 'TRACKING_VALUE_INVALID' }
  }
  const value = Math.round(v * 10000) / 10000
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (note.length > 200) return { error: 'TRACKING_NOTE_INVALID' }
  const recordedAt = parseRecordedAt(body?.recordedAt)
  if (isDateError(recordedAt)) return { error: recordedAt.error }
  return { value, note, recordedAt }
}

// ---------- 归一化 ----------

const PROJECT_FIELDS = `p.id, p.name, p.unit, p.description, p.color,
  DATE_FORMAT(p.created_at, '%Y-%m-%d') AS createdAt`

function projectRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    description: row.description,
    color: row.color ?? null,
    createdAt: row.createdAt,
    pointCount: Number(row.pointCount ?? 0),
    latestValue: row.latestValue === null || row.latestValue === undefined ? null : Number(row.latestValue),
    latestAt: row.latestAt ?? null,
    minValue: row.minValue === null || row.minValue === undefined ? null : Number(row.minValue),
    maxValue: row.maxValue === null || row.maxValue === undefined ? null : Number(row.maxValue),
  }
}

// 取本人的项目行（含所有权校验）；404 / 403 语义由调用方决定
async function findOwnedProject(id: number, user: string) {
  const [rows] = (await pool.query(
    'SELECT id, owner_username FROM tracking_projects WHERE id = ?',
    [id]
  )) as any[]
  if (!Array.isArray(rows) || rows.length === 0) return { code: 404 } as const
  if (rows[0].owner_username !== user) return { code: 403 } as const
  return { id: rows[0].id } as const
}

// ---------- 项目 CRUD ----------

// 项目列表：本人项目 + 每项聚合统计（点数/最新值与时间/极值），创建顺序
trackingRouter.get('/projects', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const [rows] = (await pool.query(
      `SELECT ${PROJECT_FIELDS},
        (SELECT COUNT(*) FROM tracking_points t WHERE t.project_id = p.id) AS pointCount,
        (SELECT t.value FROM tracking_points t WHERE t.project_id = p.id ORDER BY t.recorded_at DESC, t.id DESC LIMIT 1) AS latestValue,
        (SELECT DATE_FORMAT(t.recorded_at, '%Y-%m-%d %H:%i') FROM tracking_points t WHERE t.project_id = p.id ORDER BY t.recorded_at DESC, t.id DESC LIMIT 1) AS latestAt,
        (SELECT MIN(t.value) FROM tracking_points t WHERE t.project_id = p.id) AS \`minValue\`,
        (SELECT MAX(t.value) FROM tracking_points t WHERE t.project_id = p.id) AS \`maxValue\`
       FROM tracking_projects p WHERE p.owner_username = ? ORDER BY p.id ASC`,
      [user]
    )) as any[]
    res.json((rows as any[]).map(projectRow))
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 新建项目（登录）。按用户限流：每 10 分钟 20 个
trackingRouter.post(
  '/projects',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 20,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
    try {
      const user = sessionUsername(req)
      if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
      const v = validateProjectInput(req.body)
      if ('error' in v) return res.status(400).json({ error: v.error })

      const [[{ count }]] = (await pool.query(
        'SELECT COUNT(*) AS count FROM tracking_projects WHERE owner_username = ?',
        [user]
      )) as any[]
      if (count >= PROJECT_USER_LIMIT) return res.status(400).json({ error: 'TRACKING_PROJECT_LIMIT' })

      const [result] = (await pool.query(
        'INSERT INTO tracking_projects (owner_username, name, unit, description, color) VALUES (?, ?, ?, ?, ?)',
        [user, v.name, v.unit, v.description, v.color]
      )) as any
      const [rows] = (await pool.query(
        `SELECT ${PROJECT_FIELDS},
          0 AS pointCount, NULL AS latestValue, NULL AS latestAt, NULL AS \`minValue\`, NULL AS \`maxValue\`
         FROM tracking_projects p WHERE p.id = ?`,
        [result.insertId]
      )) as any[]
      res.json({ success: true, project: projectRow(rows[0]) })
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// 改项目（本人；全量字段）
trackingRouter.put('/projects/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const id = Number(req.params.id)
    const found = await findOwnedProject(id, user)
    if (found.code === 404) return res.status(404).json({ error: 'TRACKING_NOT_FOUND' })
    if (found.code === 403) return res.status(403).json({ error: 'NOT_ALLOWED' })

    const v = validateProjectInput(req.body)
    if ('error' in v) return res.status(400).json({ error: v.error })
    await pool.query(
      'UPDATE tracking_projects SET name = ?, unit = ?, description = ?, color = ? WHERE id = ?',
      [v.name, v.unit, v.description, v.color, id]
    )
    const [rows] = (await pool.query(
      `SELECT ${PROJECT_FIELDS},
        (SELECT COUNT(*) FROM tracking_points t WHERE t.project_id = p.id) AS pointCount,
        (SELECT t.value FROM tracking_points t WHERE t.project_id = p.id ORDER BY t.recorded_at DESC, t.id DESC LIMIT 1) AS latestValue,
        (SELECT DATE_FORMAT(t.recorded_at, '%Y-%m-%d %H:%i') FROM tracking_points t WHERE t.project_id = p.id ORDER BY t.recorded_at DESC, t.id DESC LIMIT 1) AS latestAt,
        (SELECT MIN(t.value) FROM tracking_points t WHERE t.project_id = p.id) AS \`minValue\`,
        (SELECT MAX(t.value) FROM tracking_points t WHERE t.project_id = p.id) AS \`maxValue\`
       FROM tracking_projects p WHERE p.id = ?`,
      [id]
    )) as any[]
    res.json({ success: true, project: projectRow(rows[0]) })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 删项目（本人；级联删除其数据点——无外键，手工先删子表）
trackingRouter.delete('/projects/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const id = Number(req.params.id)
    const found = await findOwnedProject(id, user)
    if (found.code === 404) return res.status(404).json({ error: 'TRACKING_NOT_FOUND' })
    if (found.code === 403) return res.status(403).json({ error: 'NOT_ALLOWED' })

    await pool.query('DELETE FROM tracking_points WHERE project_id = ?', [id])
    await pool.query('DELETE FROM tracking_projects WHERE id = ?', [id])
    res.json({ success: true })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// ---------- 数据点 ----------

// 点列表（本人项目）：recorded_at 升序；?limit 1-5000（默认 5000，超出取最近 5000 条）
trackingRouter.get('/projects/:id/points', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const id = Number(req.params.id)
    const found = await findOwnedProject(id, user)
    if (found.code === 404) return res.status(404).json({ error: 'TRACKING_NOT_FOUND' })
    if (found.code === 403) return res.status(403).json({ error: 'NOT_ALLOWED' })

    let limit = Number(req.query.limit)
    if (!Number.isFinite(limit) || limit < 1) limit = 5000
    limit = Math.min(5000, Math.floor(limit))

    // 升序整表读取是图表主路径；超限时先按降序取最近 limit 条再反转回升序
    const [rows] = (await pool.query(
      `SELECT * FROM (
         SELECT id, value, DATE_FORMAT(recorded_at, '%Y-%m-%dT%H:%i:%s') AS recordedAt, note
         FROM tracking_points WHERE project_id = ?
         ORDER BY recorded_at DESC, id DESC LIMIT ${limit}
       ) recent ORDER BY recordedAt ASC, id ASC`,
      [id]
    )) as any[]
    res.json((rows as any[]).map((r) => ({ id: r.id, value: Number(r.value), recordedAt: r.recordedAt, note: r.note })))
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 录入数据点（本人项目）。按用户限流：每 10 分钟 60 条
trackingRouter.post(
  '/projects/:id/points',
  rateLimit({
    windowMs: 10 * 60_000,
    max: 60,
    key: (req) => sessionUsername(req) ?? String(req.ip),
  }),
  async (req, res) => {
    try {
      const user = sessionUsername(req)
      if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
      const id = Number(req.params.id)
      const found = await findOwnedProject(id, user)
      if (found.code === 404) return res.status(404).json({ error: 'TRACKING_NOT_FOUND' })
      if (found.code === 403) return res.status(403).json({ error: 'NOT_ALLOWED' })

      const v = validatePointInput(req.body)
      if ('error' in v) return res.status(400).json({ error: v.error })

      const [[{ count }]] = (await pool.query(
        'SELECT COUNT(*) AS count FROM tracking_points WHERE project_id = ?',
        [id]
      )) as any[]
      if (count >= POINT_PROJECT_LIMIT) return res.status(400).json({ error: 'TRACKING_POINT_LIMIT' })

      // recordedAt 为空时 IFNULL 落 NOW()（MySQL 服务器时刻）
      const [result] = (await pool.query(
        'INSERT INTO tracking_points (project_id, value, recorded_at, note) VALUES (?, ?, IFNULL(?, NOW()), ?)',
        [id, v.value, v.recordedAt, v.note]
      )) as any
      const [rows] = (await pool.query(
        `SELECT id, value, DATE_FORMAT(recorded_at, '%Y-%m-%dT%H:%i:%s') AS recordedAt, note
         FROM tracking_points WHERE id = ?`,
        [result.insertId]
      )) as any[]
      res.json({ success: true, point: { id: rows[0].id, value: Number(rows[0].value), recordedAt: rows[0].recordedAt, note: rows[0].note } })
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
    }
  }
)

// 改数据点（本人项目；value/recordedAt/note 均可改，未传字段保持原值）
trackingRouter.put('/points/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const pointId = Number(req.params.id)
    const [[row]] = (await pool.query(
      `SELECT t.id, t.value, DATE_FORMAT(t.recorded_at, '%Y-%m-%dT%H:%i:%s') AS recordedAt, t.note, p.owner_username
       FROM tracking_points t JOIN tracking_projects p ON p.id = t.project_id WHERE t.id = ?`,
      [pointId]
    )) as any[]
    if (!row) return res.status(404).json({ error: 'TRACKING_NOT_FOUND' })
    if (row.owner_username !== user) return res.status(403).json({ error: 'NOT_ALLOWED' })

    const body = req.body ?? {}
    let value = Number(row.value)
    if (body.value !== undefined) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value) || Math.abs(body.value) >= VALUE_ABS_MAX) {
        return res.status(400).json({ error: 'TRACKING_VALUE_INVALID' })
      }
      value = Math.round(body.value * 10000) / 10000
    }
    let note: string = row.note
    if (body.note !== undefined) {
      note = typeof body.note === 'string' ? body.note.trim() : ''
      if (note.length > 200) return res.status(400).json({ error: 'TRACKING_NOTE_INVALID' })
    }
    let recordedAt: string | null = row.recordedAt.replace('T', ' ')
    if (body.recordedAt !== undefined) {
      const parsed = parseRecordedAt(body.recordedAt)
      if (isDateError(parsed)) return res.status(400).json({ error: parsed.error })
      recordedAt = parsed // null = 显式清空按 NOW()，与 POST 的空语义一致
    }

    await pool.query('UPDATE tracking_points SET value = ?, recorded_at = IFNULL(?, NOW()), note = ? WHERE id = ?', [
      value, recordedAt, note, pointId,
    ])
    const [after] = (await pool.query(
      `SELECT id, value, DATE_FORMAT(recorded_at, '%Y-%m-%dT%H:%i:%s') AS recordedAt, note
       FROM tracking_points WHERE id = ?`,
      [pointId]
    )) as any[]
    res.json({ success: true, point: { id: after[0].id, value: Number(after[0].value), recordedAt: after[0].recordedAt, note: after[0].note } })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})

// 删数据点（本人项目）
trackingRouter.delete('/points/:id', async (req, res) => {
  try {
    const user = sessionUsername(req)
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' })
    const pointId = Number(req.params.id)
    const [[row]] = (await pool.query(
      `SELECT t.id, p.owner_username FROM tracking_points t
       JOIN tracking_projects p ON p.id = t.project_id WHERE t.id = ?`,
      [pointId]
    )) as any[]
    if (!row) return res.status(404).json({ error: 'TRACKING_NOT_FOUND' })
    if (row.owner_username !== user) return res.status(403).json({ error: 'NOT_ALLOWED' })
    await pool.query('DELETE FROM tracking_points WHERE id = ?', [pointId])
    res.json({ success: true })
  } catch (e: any) {
    console.error(e); res.status(500).json({ error: 'SERVER_ERROR' })
  }
})
