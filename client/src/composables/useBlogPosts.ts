import type { BlogPost } from '../types'

/**
 * 博客内容管线（文件驱动）。
 *
 * 文章以 `client/src/content/posts/*.md` 为唯一来源：每个文件首部带 YAML 风格
 * frontmatter（title / date / category / tags / excerpt / readTime），其后是 Markdown 正文。
 * Vite 在构建期用 import.meta.glob 把所有 .md 作为原始字符串打进包，运行时解析。
 *
 * 新增文章 = 在 content/posts/ 下丢一个 .md 文件（文件名即 slug）→ 重启 dev / 重新构建，
 * 列表与详情页都会自动出现，无需手写页面、无需改库表。
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

/** 详情：按 slug 取单篇，返回元数据 + 原始 Markdown 正文。 */
export function getPost(
  slug: string,
): { post: BlogPost; body: string } | undefined {
  const post = allPosts.find((p) => p.slug === slug)
  if (!post || !post.content) return undefined
  return { post, body: post.content }
}
