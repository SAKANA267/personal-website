import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from './useApi'
import { useLocale } from '../stores/locale'

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
 * 最终 HTML 经 DOMPurify 净化——正文可能来自用户撰写（登录联动），
 * 不可信任的 Markdown 绝不能直通 v-html。
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

  // 独立成段的图片升级为 figure + figcaption：alt 文本即「图片说明」，渲染在图片下方。
  // 段落除该图外无任何文字内容才升级（行内小图保持原样）；figure/figcaption 在 DOMPurify 默认白名单内。
  root.querySelectorAll('p').forEach((p) => {
    const img = p.querySelector('img')
    if (!img || p.querySelectorAll('img').length !== 1) return
    if ((p.textContent || '').trim()) return
    const alt = (img.getAttribute('alt') || '').trim()
    const figure = doc.createElement('figure')
    figure.appendChild(img)
    if (alt) {
      const caption = doc.createElement('figcaption')
      caption.textContent = alt
      figure.appendChild(caption)
    }
    p.replaceWith(figure)
  })

  return { html: DOMPurify.sanitize(root.innerHTML), toc }
}

// ---------- 阅读页插图徽标（大小 + 查看原图） ----------

// meta 按名字缓存（含在途去重）：多篇文章 / 多次渲染重复引用同一图不重复请求
const imageMetaCache = new Map<string, Promise<{ origSize: number; dispSize: number | null } | null>>()

function fetchImageMeta(name: string) {
  let p = imageMetaCache.get(name)
  if (!p) {
    p = api.getBlogImageMeta(name).catch(() => null)
    imageMetaCache.set(name, p)
  }
  return p
}

/** 字节数 → 人类可读（248 KB / 1.2 MB）。 */
export function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`
}

const BLOG_IMG_SRC_RE = /\/blog\/images\/([0-9a-f]{32}\.(?:png|jpg|gif|webp|bmp|avif))/

/**
 * 阅读页插图增强：给 figure 里的博客插图补「展示大小 · 查看原图（原图大小）」徽标。
 * 文章默认读压缩变体，徽标展示正在读取的大小；有变体时附原图链接（新标签页）。
 * alt 为空的 figure 没有 figcaption，会自动创建一行只放徽标。
 * 幂等（data-size-badge 标记）；meta 请求失败时静默跳过，不影响阅读。
 */
export async function enhanceBlogImages(root: ParentNode): Promise<void> {
  const { t } = useLocale()
  const targets = Array.from(root.querySelectorAll('figure > img')).filter((img) => {
    if (!(img instanceof HTMLImageElement) || img.hasAttribute('data-size-badge')) return false
    return BLOG_IMG_SRC_RE.test(img.getAttribute('src') || '')
  })
  if (!targets.length) return
  for (const img of targets) img.setAttribute('data-size-badge', '1')

  const metas = await Promise.all(
    targets.map((img) => fetchImageMeta(BLOG_IMG_SRC_RE.exec(img.getAttribute('src') || '')![1]))
  )

  targets.forEach((img, i) => {
    const meta = metas[i]
    const figure = img.closest('figure')
    if (!meta || !figure) return

    let caption = figure.querySelector('figcaption')
    if (!caption) {
      caption = document.createElement('figcaption')
      figure.appendChild(caption)
    }

    const shown = meta.dispSize ?? meta.origSize
    const badge = document.createElement('span')
    badge.className = 'img-size-badge'
    badge.textContent = formatBytes(shown)
    caption.appendChild(badge)

    if (meta.dispSize != null && meta.dispSize < meta.origSize) {
      const link = document.createElement('a')
      link.className = 'img-original-link'
      // src 形如 …/blog/images/<name>，原图即同路径追加 /original
      link.href = (img.getAttribute('src') || '').replace(
        /(\/blog\/images\/[0-9a-f]{32}\.\w+)$/,
        '$1/original'
      )
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = t('blogDetail.viewOriginal', { size: formatBytes(meta.origSize) })
      caption.appendChild(link)
    }
  })
}
