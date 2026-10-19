import { pool } from './db.js'

/**
 * 全站搜索的模块开关（软编码检索范围）：
 * 服务端执行 posts/comments/devlog/messages/users 五个 DB 模块，
 * 客户端本地执行 questions/charts/pages 三个打包内容模块。
 * 存 site_settings 表的 search_scope 行（JSON），管理面板「搜索设置」可改；
 * 行缺失/解析失败一律回退默认全开——搜索可用性优先于配置精确性。
 */

export const SEARCH_MODULES = [
  'posts',
  'comments',
  'devlog',
  'messages',
  'users',
  'questions',
  'charts',
  'pages',
] as const

export type SearchModule = (typeof SEARCH_MODULES)[number]

export type SearchScope = Record<SearchModule, boolean>

export const DEFAULT_SEARCH_SCOPE: SearchScope = {
  posts: true,
  comments: true,
  devlog: true,
  messages: true,
  users: true,
  questions: true,
  charts: true,
  pages: true,
}

export const SEARCH_SCOPE_KEY = 'search_scope'

/** 任意输入 → 合法 scope（未知键丢弃、缺失键补默认），非法输入返回 null */
export function sanitizeSearchScope(input: unknown): SearchScope | null {
  if (typeof input !== 'object' || input === null) return null
  const rec = input as Record<string, unknown>
  const scope = { ...DEFAULT_SEARCH_SCOPE }
  let touched = false
  for (const m of SEARCH_MODULES) {
    if (typeof rec[m] === 'boolean') {
      scope[m] = rec[m] as boolean
      touched = true
    }
  }
  // 全部键都不合法（空对象/全是未知键）视为无效载荷；已知键之外出现任何未知键同样拒绝
  if (!touched) return null
  for (const key of Object.keys(rec)) {
    if (!(SEARCH_MODULES as readonly string[]).includes(key)) return null
  }
  return scope
}

/** 读 site_settings 里的 search_scope，合并默认值；表缺失/解析失败回退默认全开 */
export async function readSearchScope(): Promise<SearchScope> {
  try {
    const [rows] = (await pool.query('SELECT v FROM site_settings WHERE k = ?', [
      SEARCH_SCOPE_KEY,
    ])) as any[]
    const row = (rows as any[])[0]
    if (!row) return { ...DEFAULT_SEARCH_SCOPE }
    const parsed = JSON.parse(String(row.v))
    const scope = { ...DEFAULT_SEARCH_SCOPE }
    for (const m of SEARCH_MODULES) {
      if (typeof parsed?.[m] === 'boolean') scope[m] = parsed[m]
    }
    return scope
  } catch {
    return { ...DEFAULT_SEARCH_SCOPE }
  }
}

/** 保存 scope（UPSERT 一行 JSON） */
export async function saveSearchScope(scope: SearchScope): Promise<void> {
  await pool.query(
    'INSERT INTO site_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [SEARCH_SCOPE_KEY, JSON.stringify(scope)]
  )
}
