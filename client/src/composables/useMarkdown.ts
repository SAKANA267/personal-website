import { marked } from 'marked'

export interface TocItem {
  id: string
  text: string
  level: number // 2 = h2, 3 = h3
}

export interface RenderedMarkdown {
  html: string
  toc: TocItem[]
}

// GitHub 风格换行；保持同步渲染
marked.setOptions({ gfm: true, breaks: false })

/**
 * Unicode 友好的标题锚点 slug：保留字母 / 数字（含中文等 unicode 字母），
 * 空白与标点转 `-`。例：「章节 A」→ `章节-a`，「Get started」→ `get-started`。
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s.]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 把 Markdown 正文渲染为 HTML，同时为 h2/h3 注入锚点 id 并抽取目录。
 * 实现：marked 先出 HTML → DOMParser 后处理注入 id 与抽取 TOC，
 * 避开不同 marked 版本 renderer API 的差异。
 */
export function renderMarkdown(raw: string): RenderedMarkdown {
  const html = marked.parse(raw, { async: false }) as string
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body

  const toc: TocItem[] = []
  const seen = new Map<string, number>()

  root.querySelectorAll('h2, h3').forEach((el) => {
    const text = (el.textContent || '').trim()
    if (!text) return

    let id = slugify(text) || 'section'
    const count = seen.get(id) ?? 0
    seen.set(id, count + 1)
    if (count > 0) id = `${id}-${count}`

    el.id = id
    toc.push({ id, text, level: el.tagName === 'H2' ? 2 : 3 })
  })

  return { html: root.innerHTML, toc }
}
