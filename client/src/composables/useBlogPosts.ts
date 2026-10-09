import { ref } from 'vue'
import type { BlogPost } from '../types'
import { api } from './useApi'

/**
 * 博客内容管线（文件驱动 + DB 用户文章双来源）。
 *
 * 静态文章：`client/src/content/posts/*.md` 为来源，首部 YAML 风格 frontmatter + Markdown 正文，
 * Vite 构建期用 import.meta.glob 打进包。新增 = 丢一个 .md 文件。
 *
 * 用户文章：登录用户撰写，存服务端 blog_posts（slug 以 u- 开头），运行时经 /api/blog 拉取，
 * 与静态文章按日期倒序合并展示；评论/点赞也以 slug 为键（静态文章同样可评论点赞）。
 */
const modules = import.meta.glob('../content/posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** 剥离首部 `---\n...\n---` frontmatter，按首个 `:` 切键值。 */
function parseFrontmatter(raw: string): {
  meta: Record<string, string>
  body: string
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) meta[key] = value
  }
  return { meta, body: raw.slice(match[0].length) }
}

/** 解析 `[a, b, c]` 形式的 tags。 */
function parseTags(raw: string): string[] {
  return raw
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * 从正文派生摘要：剥离 Markdown 标记（标题/强调/链接/代码块/图片/HTML 等），
 * 取前若干字。用于 frontmatter 未写 excerpt 时的回退。
 */
function deriveExcerpt(body: string, max = 80): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ') // 围栏代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 → 文字
    .replace(/`([^`]+)`/g, '$1') // 行内代码
    .replace(/^\s{0,3}(#{1,6}\s*|>\s*|[-*+]\s+|\d+\.\s+)/gm, '') // 标题/引用/列表标记
    .replace(/[*_~]+/g, '') // 强调/删除线
    .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, ' ') // 分隔线
    .replace(/<[^>]+>/g, ' ') // HTML 标签
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

function buildPost(path: string, raw: string): BlogPost {
  const { meta, body } = parseFrontmatter(raw)
  const readTimeNum = Number(meta.readTime)
  return {
    slug: (path.split('/').pop() ?? path).replace(/\.md$/i, ''),
    title: meta.title ?? '(无标题)',
    excerpt: meta.excerpt?.trim() || deriveExcerpt(body),
    date: meta.date ?? '',
    category: meta.category ?? '随笔',
    tags: parseTags(meta.tags ?? ''),
    readTime: Number.isFinite(readTimeNum) ? readTimeNum : undefined,
    content: body.trim(),
  }
}

// 启动期一次性解析全部文章，按日期倒序（最新在前），日期相同按 slug 兜底
const allPosts: BlogPost[] = Object.entries(modules)
  .map(([path, raw]) => buildPost(path, raw))
  .sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug))
  .reverse()

/** 列表：返回元数据（含正文，但列表视图只读 meta 字段）。 */
export function getAllPosts(): BlogPost[] {
  return allPosts
}

/** 详情：按 slug 取单篇（静态文章），返回元数据 + 原始 Markdown 正文。 */
export function getPost(
  slug: string,
): { post: BlogPost; body: string } | undefined {
  const post = allPosts.find((p) => p.slug === slug)
  if (!post || !post.content) return undefined
  return { post, body: post.content }
}

// ---------- DB 用户文章（登录联动） ----------

// 响应式 DB 文章列表（含自己的草稿）；请求失败保持空，静态文章不受影响
const dbPosts = ref<BlogPost[]>([])

/** 拉取/刷新 DB 用户文章列表（列表页挂载、撰写/编辑/删除后调用）。 */
export async function refreshDbPosts(): Promise<void> {
  try {
    const rows = await api.getDbPosts()
    if (Array.isArray(rows)) dbPosts.value = rows
  } catch {
    // 网络异常时保留旧数据
  }
}

/** 合并流：静态 .md 文章 + DB 用户文章，按日期倒序（同日 DB 文章在前）。 */
export function mergedPosts(): BlogPost[] {
  return [...allPosts, ...dbPosts.value].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date)
    if (byDate !== 0) return byDate
    const aDb = a.slug.startsWith('u-') ? 0 : 1
    const bDb = b.slug.startsWith('u-') ? 0 : 1
    return aDb - bDb
  })
}

/** DB 文章响应式列表（视图里 computed 引用，刷新后自动更新）。 */
export function useDbPosts() {
  return dbPosts
}
