<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import { getAllPosts } from '../composables/useBlogPosts'
import type { BlogPost } from '../types'

const router = useRouter()
const query = ref('')
const activeCategory = ref('All')
const currentPage = ref(1)
const pageSize = 5

// 文章来源：本地 content/posts/*.md（文件驱动），按日期倒序
const posts = computed<BlogPost[]>(() => getAllPosts())

function openPost(slug: string) {
  router.push(`/blog/${slug}`)
}

// 从文章派生分类，前置一个 "All"
const categories = computed<string[]>(() => {
  const set = new Set<string>(posts.value.map((p) => p.category))
  return ['All', ...Array.from(set)]
})

// 按分类 + 关键词过滤（标题 / 摘要 / 标签 / 分类，忽略大小写）
const filtered = computed<BlogPost[]>(() => {
  const q = query.value.trim().toLowerCase()
  return posts.value.filter((p) => {
    if (activeCategory.value !== 'All' && p.category !== activeCategory.value) return false
    if (!q) return true
    return (
      p.title.toLowerCase().includes(q) ||
      p.excerpt.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
    )
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))

const pageNumbers = computed(() =>
  Array.from({ length: totalPages.value }, (_, i) => i + 1),
)

const paged = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return filtered.value.slice(start, start + pageSize)
})

// 过滤条件变化时回到第一页
function setCategory(c: string) {
  activeCategory.value = c
  currentPage.value = 1
}
function onSearch() {
  currentPage.value = 1
}
function goToPage(n: number) {
  if (n >= 1 && n <= totalPages.value) currentPage.value = n
}
</script>

<template>
  <div class="page-blog">
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }]" />

    <!-- 刊头 Masthead -->
    <header class="masthead">
      <p class="masthead-eyebrow">WRITINGS · 2026</p>
      <h1 class="masthead-title">Blog</h1>
      <WriterByline />
    </header>

    <hr class="rule" />

    <!-- 分类 + 搜索 -->
    <div class="toolbar">
      <nav class="filters" aria-label="文章分类">
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          class="filter-tab"
          :class="{ active: activeCategory === c }"
          @click="setCategory(c)"
        >
          {{ c }}
        </button>
      </nav>
      <div class="search">
        <input
          v-model="query"
          class="blog-search"
          type="search"
          placeholder="搜索文章…"
          aria-label="搜索文章"
          @input="onSearch"
        />
      </div>
    </div>

    <!-- 文章流 -->
    <main class="feed">
      <article
        v-for="(post, index) in paged"
        :key="post.slug"
        class="post-row"
        :style="{ animationDelay: (index + 1) * 0.12 + 's' }"
        tabindex="0"
        role="link"
        :aria-label="`阅读文章：${post.title}`"
        @click="openPost(post.slug)"
        @keydown.enter="openPost(post.slug)"
      >
        <div class="post-main">
          <p class="post-meta">
            <span class="post-date">{{ post.date }}</span>
            <span class="meta-sep">·</span>
            <span class="post-cat">{{ post.category }}</span>
            <template v-if="post.readTime">
              <span class="meta-sep">·</span>
              <span class="post-read">{{ post.readTime }} min</span>
            </template>
          </p>
          <h2 class="post-title">{{ post.title }}</h2>
          <p class="post-excerpt">{{ post.excerpt }}</p>
          <ul class="post-tags">
            <li v-for="t in post.tags" :key="t" class="tag">#{{ t }}</li>
          </ul>
        </div>
        <span class="post-arrow" aria-hidden="true">→</span>
      </article>

      <!-- 空状态 -->
      <p v-if="filtered.length === 0" class="empty-state">
        没有匹配「{{ query || activeCategory }}」的文章
      </p>
    </main>

    <!-- 分页 -->
    <nav v-if="totalPages > 1" class="blog-pagination" aria-label="分页">
      <button
        type="button"
        class="page-btn"
        :disabled="currentPage === 1"
        @click="goToPage(currentPage - 1)"
      >
        ←
      </button>
      <button
        v-for="n in pageNumbers"
        :key="n"
        type="button"
        class="page-btn"
        :class="{ active: n === currentPage }"
        @click="goToPage(n)"
      >
        {{ n }}
      </button>
      <button
        type="button"
        class="page-btn"
        :disabled="currentPage === totalPages"
        @click="goToPage(currentPage + 1)"
      >
        →
      </button>
    </nav>
  </div>
</template>
