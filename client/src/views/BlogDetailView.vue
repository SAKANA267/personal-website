<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { getAllPosts, getPost } from '../composables/useBlogPosts'
import { renderMarkdown } from '../composables/useMarkdown'
import type { BlogPost } from '../types'

const route = useRoute()
const router = useRouter()

const slug = computed(() => String(route.params.slug ?? ''))

const found = computed(() => getPost(slug.value))
const post = computed<BlogPost | undefined>(() => found.value?.post)
const body = computed(() => found.value?.body ?? '')

// 解析正文为 HTML + 目录（带 h2/h3 锚点 id）
const rendered = computed(() =>
  body.value ? renderMarkdown(body.value) : { html: '', toc: [] },
)
const articleHtml = computed(() => rendered.value.html)
const toc = computed(() => rendered.value.toc)

// 上一篇 / 下一篇：getAllPosts 已按日期倒序（最新在前）。
// 列表从上往下读即「新→旧」，因此 ←上一篇 = 更新的一篇（索引更小），下一篇→ = 更早的一篇。
const neighbours = computed(() => {
  const all = getAllPosts()
  const i = all.findIndex((p) => p.slug === slug.value)
  return {
    prev: i > 0 ? all[i - 1] : undefined, // 更新
    next: i >= 0 && i < all.length - 1 ? all[i + 1] : undefined, // 更早
  }
})

function go(targetSlug: string) {
  router.push(`/blog/${targetSlug}`)
}
function back() {
  router.push('/blog')
}

// 点击 TOC：平滑滚动到对应标题（尊重 prefers-reduced-motion），href 仍保留作语义/后备
function onTocClick(e: MouseEvent, id: string) {
  e.preventDefault()
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  activeId.value = id
}

// 右侧 TOC 当前章节高亮（scrollspy）：把 active 设为「最后一个已越过判定线的标题」，
// 判定线取视口顶部 ~30%。比 IntersectionObserver 更稳定，能正确处理短标题仅底部入栏、
// 以及程序化平滑滚动停下后不再触发交集变化的边界情况。
const activeId = ref('')

function updateActive() {
  const container = document.querySelector<HTMLElement>(
    '.page-blog-detail .markdown-body',
  )
  if (!container) return
  const headings = Array.from(container.querySelectorAll<HTMLElement>('h2, h3'))
  if (!headings.length) return
  const line = Math.max(80, window.innerHeight * 0.3)
  let current = headings[0].id
  for (const h of headings) {
    if (h.getBoundingClientRect().top <= line) current = h.id
    else break
  }
  activeId.value = current
}

function onScroll() {
  updateActive()
}

onMounted(async () => {
  window.scrollTo({ top: 0 })
  window.addEventListener('scroll', onScroll, { passive: true })
  await nextTick()
  updateActive()
})

// 组件复用、仅 slug 变化时（上一篇/下一篇跳转）回顶并重算高亮
watch(slug, async () => {
  window.scrollTo({ top: 0 })
  await nextTick()
  updateActive()
})

onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <div class="page-blog-detail">
    <template v-if="post">
      <!-- 刊头 -->
      <header class="masthead">
        <p class="masthead-eyebrow">{{ post.category }} · {{ post.date }}</p>
        <h1 class="masthead-title">{{ post.title }}</h1>
        <WriterByline />
      </header>

      <hr class="rule" />

      <!-- 元数据条 -->
      <div class="post-meta-strip">
        <span class="meta-item">
          <span class="meta-k">DATE</span>
          <span class="meta-v">{{ post.date }}</span>
        </span>
        <span class="meta-item">
          <span class="meta-k">CATEGORY</span>
          <span class="meta-v">{{ post.category }}</span>
        </span>
        <span v-if="post.readTime" class="meta-item">
          <span class="meta-k">READ</span>
          <span class="meta-v">{{ post.readTime }} min</span>
        </span>
        <span v-if="post.tags.length" class="meta-item meta-tags">
          <span class="meta-k">TAGS</span>
          <span class="meta-v">
            <span v-for="t in post.tags" :key="t" class="tag">#{{ t }}</span>
          </span>
        </span>
      </div>

      <!-- 正文 + 右侧目录 -->
      <div class="article-layout">
        <article class="markdown-body" v-html="articleHtml"></article>

        <aside v-if="toc.length" class="toc" aria-label="本页目录">
          <p class="toc-title">ON THIS PAGE</p>
          <nav>
            <ul>
              <li
                v-for="item in toc"
                :key="item.id"
                :class="['toc-item', `toc-l${item.level}`, { active: activeId === item.id }]"
              >
                <a :href="`#${item.id}`" @click="onTocClick($event, item.id)">{{ item.text }}</a>
              </li>
            </ul>
          </nav>
        </aside>
      </div>

      <!-- 上一篇 / 下一篇 -->
      <nav class="post-nav" aria-label="文章导航">
        <button
          v-if="neighbours.prev"
          type="button"
          class="nav-row"
          @click="go(neighbours.prev.slug)"
        >
          <span class="nav-dir">← 上一篇</span>
          <span class="nav-title">{{ neighbours.prev.title }}</span>
        </button>
        <span v-else class="nav-row nav-empty" aria-hidden="true"></span>

        <button
          v-if="neighbours.next"
          type="button"
          class="nav-row nav-right"
          @click="go(neighbours.next.slug)"
        >
          <span class="nav-dir">下一篇 →</span>
          <span class="nav-title">{{ neighbours.next.title }}</span>
        </button>
        <span v-else class="nav-row nav-empty" aria-hidden="true"></span>
      </nav>

      <p class="back-link">
        <button type="button" class="back-btn" @click="back">← 返回博客</button>
      </p>
    </template>

    <!-- 文章不存在 -->
    <div v-else class="not-found">
      <p class="nf-title">文章不存在</p>
      <p class="nf-desc">没有找到「{{ slug }}」对应的文章。</p>
      <button type="button" class="back-btn" @click="back">← 返回博客</button>
    </div>
  </div>
</template>
