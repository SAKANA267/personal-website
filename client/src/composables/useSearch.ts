import { computed, ref, watch } from 'vue'
import { api } from './useApi'
import { getAllPosts } from './useBlogPosts'
import { chartsLabCases } from '../content/chartsLabCases'
import { useAuth } from '../stores/auth'
import { useLocale, type MessageKey } from '../stores/locale'
import type { Question, SearchScope, ServerSearchResults } from '../types'

/**
 * 全站搜索状态与检索逻辑（Ctrl+K 弹窗，模块级单例——与 useDataMask 同风格）。
 *
 * 检索为「本地 + 服务端」合并：静态博文/题库/图表实验室/页面入口在浏览器本地索引
 * （同步、随输入即时），DB 内容（用户博文正文/评论/开发日志/留言板/用户主页）走
 * GET /api/search（200ms 防抖 + AbortController 中止旧请求 + seq 乱序守卫）。
 * 检索范围按管理面板「搜索设置」的模块开关过滤（scope，60s TTL，失败回退全开）。
 * 导航动作不在此层：组件拿分组结果自行 router.push，跳转照常走 600ms 四色块遮罩。
 */

export type SearchGroupKey =
  | 'blog'
  | 'comments'
  | 'questions'
  | 'charts'
  | 'devlog'
  | 'messages'
  | 'users'
  | 'pages'

export interface SearchItem {
  key: string
  group: SearchGroupKey
  title: string // 主标题（组件里高亮）
  snippet: string // 次行摘要（组件里高亮）
  meta: string // 弱化元信息（日期/分类/@用户名）
  to: string // 路由目标
}

export interface SearchGroup {
  key: SearchGroupKey
  items: SearchItem[]
}

const GROUP_ORDER: SearchGroupKey[] = [
  'blog',
  'comments',
  'questions',
  'charts',
  'devlog',
  'messages',
  'users',
]

// 页面快捷入口（空 query 的快捷面板 / 少结果兜底组共用）；
// kw 为中英关键词（小写比较），保证输入 blog / 博客 都能命中
const PAGE_ENTRIES: { to: string; labelKey: MessageKey; kw: string }[] = [
  { to: '/', labelKey: 'search.pageHome', kw: 'home 主页 首页 留言板 message board' },
  { to: '/online-chat', labelKey: 'search.pageChat', kw: 'chat 聊天 聊天室 room' },
  { to: '/question-bank', labelKey: 'search.pageQuestions', kw: 'question bank 题库 quiz 刷题' },
  { to: '/dev-log', labelKey: 'search.pageDevlog', kw: 'dev log 开发日志 changelog' },
  { to: '/blog', labelKey: 'search.pageBlog', kw: 'blog 博客 文章 posts' },
  { to: '/share', labelKey: 'search.pageShare', kw: 'share 分享 二维码 qr 取件' },
  { to: '/charts-lab', labelKey: 'search.pageCharts', kw: 'charts 图表 实验室 lab 可视化' },
  { to: '/data-mask', labelKey: 'search.pageMask', kw: 'data mask 数据脱敏 excel csv' },
]

const DEFAULT_SCOPE: SearchScope = {
  posts: true,
  comments: true,
  devlog: true,
  messages: true,
  users: true,
  questions: true,
  charts: true,
  pages: true,
}

/** Markdown → 纯文本（轻量剥离标记，供正文命中时取摘要窗口） */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s*|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 取命中位置附近的摘要窗口（前后各 radius 字符，越界补省略号） */
function snippetAround(text: string, q: string, radius = 36): string {
  const needle = q.toLowerCase()
  const idx = text.toLowerCase().indexOf(needle)
  const width = radius * 2
  if (idx === -1) return text.length > width ? text.slice(0, width).trimEnd() + '…' : text
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + needle.length + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}

/** 文案按命中切片（组件渲染 <mark> 用；大小写不敏感，逐次全部命中） */
export function highlightParts(text: string, q: string): { text: string; hit: boolean }[] {
  const needle = q.trim().toLowerCase()
  if (!needle || !text) return text ? [{ text, hit: false }] : []
  const lower = text.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let i = 0
  for (;;) {
    const idx = lower.indexOf(needle, i)
    if (idx === -1) {
      if (i < text.length) parts.push({ text: text.slice(i), hit: false })
      break
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), hit: false })
    parts.push({ text: text.slice(idx, idx + needle.length), hit: true })
    i = idx + needle.length
  }
  return parts
}

// ---------- 模块状态 ----------

const open = ref(false)
const query = ref('')
const scope = ref<SearchScope>({ ...DEFAULT_SCOPE })
const serverState = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
const serverResults = ref<ServerSearchResults | null>(null)

let triggerEl: HTMLElement | null = null

const { t } = useLocale()
const { username } = useAuth()

const trimmedQuery = computed(() => query.value.trim())

// ---------- 本地索引（同步、随输入即时） ----------

const localItems = computed<SearchItem[]>(() => {
  const q = trimmedQuery.value
  if (!q) return []
  const ql = q.toLowerCase()
  const out: SearchItem[] = []

  // 静态博文：标题前缀 > 标题包含 > 标签/分类 > 摘要 > 正文（标题命中展示摘要，正文命中取纯文本窗口）
  if (scope.value.posts) {
    const scored: { item: SearchItem; score: number }[] = []
    for (const p of getAllPosts()) {
      const title = p.title.toLowerCase()
      let score = 0
      if (title.startsWith(ql)) score = 5
      else if (title.includes(ql)) score = 4
      else if (
        p.tags.some((tg) => tg.toLowerCase().includes(ql)) ||
        p.category.toLowerCase().includes(ql)
      )
        score = 2.5
      else if (p.excerpt.toLowerCase().includes(ql)) score = 2
      else if ((p.content ?? '').toLowerCase().includes(ql)) score = 1
      if (!score) continue
      const snippet =
        score >= 4 ? p.excerpt : snippetAround(plainText(p.content ?? ''), q)
      scored.push({
        item: {
          key: `post-${p.slug}`,
          group: 'blog',
          title: p.title,
          snippet,
          meta: `${p.date} · ${p.category}`,
          to: `/blog/${p.slug}`,
        },
        score,
      })
    }
    scored.sort((a, b) => b.score - a.score)
    out.push(...scored.slice(0, 6).map((s) => s.item))
  }

  // 图表实验室案例卡（name/family/shape/summary/note/prompt 全字段）
  if (scope.value.charts) {
    for (const c of chartsLabCases) {
      const hay = `${c.name} ${c.family} ${c.shape} ${c.summary} ${c.note} ${c.prompt}`.toLowerCase()
      if (!hay.includes(ql)) continue
      out.push({
        key: `chart-${c.id}`,
        group: 'charts',
        title: c.name,
        snippet: c.name.toLowerCase().includes(ql)
          ? c.summary
          : snippetAround(`${c.summary} ${c.note}`, q),
        meta: `${c.id} · ${c.shape}`,
        to: '/charts-lab',
      })
    }
  }

  // 题库（localStorage 私人数据，每次现读；与 QuestionBankView 同键规则）
  if (scope.value.questions) {
    const storeKey = username.value ? `questions:${username.value}` : 'questions'
    let list: Question[] = []
    try {
      const raw = localStorage.getItem(storeKey)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) list = parsed
    } catch {
      // 坏数据当空处理
    }
    let picked = 0
    for (let i = 0; i < list.length && picked < 5; i++) {
      const item = list[i]
      const hay = `${item.question} ${item.options.join(' ')}`.toLowerCase()
      if (!hay.includes(ql)) continue
      out.push({
        key: `question-${i}`,
        group: 'questions',
        title: item.question.length > 60 ? item.question.slice(0, 60) + '…' : item.question,
        snippet: snippetAround(item.question, q, 30),
        meta: '',
        to: '/question-bank',
      })
      picked++
    }
  }

  return out
})

// ---------- 页面快捷入口 / 兜底 ----------

const pageEntries = computed(() =>
  PAGE_ENTRIES.map((e) => ({ to: e.to, label: t(e.labelKey), kw: e.kw }))
)

function pagesToItems(
  entries: { to: string; label: string }[]
): SearchItem[] {
  return entries.map((e) => ({
    key: `page-${e.to}`,
    group: 'pages' as const,
    title: e.label,
    snippet: e.to,
    meta: '',
    to: e.to,
  }))
}

const matchedPages = computed<SearchItem[]>(() => {
  const q = trimmedQuery.value
  if (!q || !scope.value.pages) return []
  const ql = q.toLowerCase()
  return pagesToItems(
    pageEntries.value.filter(
      (e) => e.label.toLowerCase().includes(ql) || e.kw.toLowerCase().includes(ql)
    )
  )
})

/** 空 query 快捷面板的条目（键盘导航与空态兜底共用 quickItems） */
const quickItems = computed<SearchItem[]>(() => pagesToItems(pageEntries.value))

// ---------- 服务端检索（防抖 + 中止 + 乱序守卫） ----------

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let fetchSeq = 0
let controller: AbortController | null = null

watch(query, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const qq = q.trim()
  if (!qq) {
    serverState.value = 'idle'
    serverResults.value = null
    return
  }
  debounceTimer = setTimeout(() => {
    void runServerSearch(qq)
  }, 200)
})

async function runServerSearch(q: string) {
  const seq = ++fetchSeq
  controller?.abort()
  controller = new AbortController()
  serverState.value = 'loading'
  try {
    const res = await api.search(q, controller.signal)
    if (seq !== fetchSeq) return
    if (res.ok && Array.isArray((res.data as ServerSearchResults | null)?.posts)) {
      serverResults.value = res.data
      serverState.value = 'done'
    } else {
      serverState.value = 'error'
    }
  } catch {
    // 中止（AbortError）只会发生在新请求已接棒时，seq 守卫直接丢弃
    if (seq !== fetchSeq) return
    serverState.value = 'error'
  }
}

// ---------- 合并分组 ----------

const contentGroups = computed<SearchGroup[]>(() => {
  const q = trimmedQuery.value
  if (!q) return []
  const items = [...localItems.value]
  const sr = serverResults.value
  if (sr && serverState.value === 'done') {
    for (const p of sr.posts) {
      items.push({
        key: `sp-${p.slug}`,
        group: 'blog',
        title: p.title,
        snippet: p.snippet,
        meta: `${p.date} · ${p.category}`,
        to: `/blog/${p.slug}`,
      })
    }
    for (const [i, c] of sr.comments.entries()) {
      items.push({
        key: `sc-${i}`,
        group: 'comments',
        title: c.postTitle,
        snippet: c.snippet,
        meta: `@${c.username}`,
        to: `/blog/${c.postSlug}`,
      })
    }
    for (const [i, d] of sr.devlogs.entries()) {
      items.push({
        key: `sd-${i}`,
        group: 'devlog',
        title: d.description.length > 80 ? d.description.slice(0, 80) + '…' : d.description,
        snippet: '',
        meta: d.timestamp,
        to: '/dev-log',
      })
    }
    for (const [i, m] of sr.messages.entries()) {
      items.push({
        key: `sm-${i}`,
        group: 'messages',
        title: m.name,
        snippet: m.snippet,
        meta: m.timestamp,
        to: '/',
      })
    }
    for (const u of sr.users) {
      items.push({
        key: `su-${u.username}`,
        group: 'users',
        title: u.displayName || u.username,
        snippet: u.bio,
        meta: `@${u.username}`,
        to: `/u/${u.username}`,
      })
    }
  }
  const byGroup = new Map<SearchGroupKey, SearchItem[]>()
  for (const it of items) {
    const arr = byGroup.get(it.group)
    if (arr) arr.push(it)
    else byGroup.set(it.group, [it])
  }
  return GROUP_ORDER.filter((k) => byGroup.has(k)).map((k) => ({
    key: k,
    items: byGroup.get(k)!,
  }))
})

const totalResults = computed(() =>
  contentGroups.value.reduce((sum, g) => sum + g.items.length, 0)
)

/** 少结果兜底：命中页面存在即追加；内容结果 >0 且 <3 时补全量页面为「相关页面」 */
const fallbackPages = computed<SearchItem[]>(() => {
  const q = trimmedQuery.value
  if (!q || !scope.value.pages) return []
  if (matchedPages.value.length) return matchedPages.value
  if (totalResults.value > 0 && totalResults.value < 3) return pagesToItems(pageEntries.value)
  return []
})

/** 空态：有关键词、无任何内容结果、无命中页面、且服务端不在途（loading 中不判空） */
const isEmpty = computed(
  () =>
    !!trimmedQuery.value &&
    totalResults.value === 0 &&
    matchedPages.value.length === 0 &&
    serverState.value !== 'loading' &&
    serverState.value !== 'idle'
)

// ---------- 模块开关（管理面板配置下发，60s TTL，失败回退全开） ----------

let scopeFetchedAt = 0

async function ensureScope() {
  if (Date.now() - scopeFetchedAt < 60_000) return
  try {
    const data = await api.getSearchScope()
    const m = data?.modules
    if (m && typeof m === 'object') {
      const merged = { ...DEFAULT_SCOPE }
      for (const k of Object.keys(DEFAULT_SCOPE) as (keyof SearchScope)[]) {
        if (typeof m[k] === 'boolean') merged[k] = m[k] as boolean
      }
      scope.value = merged
      scopeFetchedAt = Date.now()
    }
  } catch {
    // 拉取失败保持现值（默认全开），下次打开重试
  }
}

// ---------- 开合 ----------

function openSearch(trigger?: HTMLElement) {
  if (trigger) triggerEl = trigger
  open.value = true
  void ensureScope()
}

/** refocus=false 供跳转前收起（不抢焦点），Esc/遮罩关闭则焦点还给触发按钮 */
function closeSearch(refocus = true) {
  open.value = false
  query.value = '' // 触发 watch → idle，防抖定时器一并清掉
  serverResults.value = null
  serverState.value = 'idle'
  const el = triggerEl
  triggerEl = null
  if (refocus) el?.focus()
}

export function useSearch() {
  return {
    open,
    query,
    serverState,
    scope,
    contentGroups,
    totalResults,
    pageEntries,
    quickItems,
    matchedPages,
    fallbackPages,
    isEmpty,
    openSearch,
    closeSearch,
    highlightParts,
  }
}
