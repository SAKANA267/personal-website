<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { mergedPosts, useDbPosts, refreshDbPosts } from '../composables/useBlogPosts'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'
import type { BlogPost } from '../types'

const router = useRouter()
const query = ref('')
const activeCategory = ref('All')
const currentPage = ref(1)
const pageSize = 5

// 登录联动：已登录显示「写文章」入口；作者/管理员可编辑删除
const { username, isAdmin } = useAuth()
const dbPosts = useDbPosts()

// 文章来源：静态 .md（打包期）+ DB 用户文章（useDbPosts 响应式），按日期倒序合并
// 挂载拉一次；登录态变化（登录见草稿/退出去草稿）时重拉，避免读到上一身份的缓存
const posts = computed<BlogPost[]>(() => mergedPosts())
onMounted(refreshDbPosts)
watch(username, () => refreshDbPosts())

function openPost(slug: string) {
  router.push(`/blog/${slug}`)
}

// 作者/管理员判断（用于行内管理按钮）
function canManage(post: BlogPost): boolean {
  return post.id != null && (post.author === username.value || isAdmin.value)
}

async function removePost(post: BlogPost) {
  if (post.id == null) return
  if (!window.confirm(`删除文章「${post.title}」？评论与点赞将一并删除。`)) return
  const res = await api.deletePost(post.id)
  if (res.ok) refreshDbPosts()
}

// 从文章派生分类，前置一个 "All"
const categories = computed<string[]>(() => {
  const set = new Set<string>()
  for (const p of posts.value) if (p.category) set.add(p.category)
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

    <!-- 刊头 Masthead -->
    <header class="masthead">
      <p class="masthead-eyebrow">WRITINGS · 2026</p>
      <h1 class="masthead-title">Blog</h1>
      <WriterByline />
    </header>

    <hr class="rule" />

    <!-- 分类 + 搜索 + 写作入口 -->
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
      <div class="toolbar-right">
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
        <!-- 登录联动：登录用户可撰写文章 -->
        <button v-if="username" type="button" class="compose-btn" @click="router.push('/blog/compose')">
          写文章
        </button>
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
            <!-- 登录联动：用户文章署名作者；草稿仅作者/管理员可见 -->
            <template v-if="post.author">
              <span class="meta-sep">·</span>
              <span class="post-author">{{ post.author }}</span>
            </template>
            <span v-if="post.isPublished === 0" class="post-draft-badge">草稿</span>
            <template v-if="post.readTime">
              <span class="meta-sep">·</span>
              <span class="post-read">{{ post.readTime }} min</span>
            </template>
          </p>
          <h2 class="post-title">{{ post.title }}</h2>
          <p class="post-excerpt">{{ post.excerpt }}</p>
          <ul v-if="post.tags.length" class="post-tags">
            <li v-for="t in post.tags" :key="t" class="tag">#{{ t }}</li>
          </ul>
          <!-- 作者/管理员：编辑与删除（不触发打开文章） -->
          <div v-if="canManage(post)" class="post-manage" @click.stop>
            <button type="button" class="post-manage-btn" @click.stop="router.push(`/blog/compose?slug=${post.slug}`)">
              编辑
            </button>
            <button type="button" class="post-manage-btn post-manage-danger" @click.stop="removePost(post)">
              删除
            </button>
          </div>
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
