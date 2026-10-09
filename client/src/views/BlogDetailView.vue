<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WriterByline from '../components/WriterByline.vue'
import { getPost, mergedPosts, refreshDbPosts } from '../composables/useBlogPosts'
import { renderMarkdown } from '../composables/useMarkdown'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'
import type { BlogPost, PostComment } from '../types'

const route = useRoute()
const router = useRouter()
const { t } = useLocale()

const slug = computed(() => String(route.params.slug ?? ''))

// ---------- 文章解析：静态 .md 同步取；DB 用户文章（u- 前缀）异步拉 ----------
const staticFound = computed(() => getPost(slug.value))
const dbDetail = ref<BlogPost | null>(null)
const dbLoading = ref(false)
const dbMissing = ref(false)

async function loadDbPost(s: string) {
  if (!s.startsWith('u-')) return
  dbLoading.value = true
  dbMissing.value = false
  const res = await api.getDbPost(s)
  dbLoading.value = false
  if (res.ok && res.data?.slug) {
    dbDetail.value = res.data
  } else {
    dbDetail.value = null
    dbMissing.value = true
  }
}
watch(slug, (s) => {
  dbDetail.value = null
  loadDbPost(s)
}, { immediate: true })

const post = computed<BlogPost | undefined>(() => staticFound.value?.post ?? dbDetail.value ?? undefined)
const body = computed(() => staticFound.value?.body ?? dbDetail.value?.body ?? '')

// 解析正文为 HTML + 目录（带 h2/h3 锚点 id；DOMPurify 净化，正文可能来自用户撰写）
const rendered = computed(() =>
  body.value ? renderMarkdown(body.value) : { html: '', toc: [] },
)
const articleHtml = computed(() => rendered.value.html)
const toc = computed(() => rendered.value.toc)

// 上一篇 / 下一篇：mergedPosts 已按日期倒序（最新在前）。
const neighbours = computed(() => {
  const all = mergedPosts()
  const i = all.findIndex((p) => p.slug === slug.value)
  return {
    prev: i > 0 ? all[i - 1] : undefined, // 更新
    next: i >= 0 && i < all.length - 1 ? all[i + 1] : undefined, // 更早
  }
})

// ---------- 登录联动：作者/管理员管理、点赞、评论 ----------
const { username, isAdmin } = useAuth()
const canManage = computed(() =>
  !!post.value?.id && (post.value?.author === username.value || isAdmin.value)
)

async function deleteThisPost() {
  if (post.value?.id == null) return
  if (!window.confirm(t('blog.confirmDelete', { title: post.value.title }))) return
  const res = await api.deletePost(post.value.id)
  if (res.ok) {
    await refreshDbPosts()
    router.push('/blog')
  }
}

// 点赞：总数 + 当前用户是否已赞；游客点击去登录
const likes = ref({ count: 0, liked: false })
const likePending = ref(false)

async function loadLikes(s: string) {
  try {
    likes.value = await api.getLikes(s)
  } catch {
    likes.value = { count: 0, liked: false }
  }
}
async function toggleLike() {
  if (!username.value) {
    router.push('/login')
    return
  }
  if (likePending.value) return
  likePending.value = true
  const res = await api.toggleLike(slug.value)
  likePending.value = false
  if (res.ok && typeof res.data.count === 'number') likes.value = res.data
}

// 评论：时间正序列表；登录发表；本人/管理员可删
const comments = ref<PostComment[]>([])
const commentText = ref('')
const commentPending = ref(false)

async function loadComments(s: string) {
  try {
    const rows = await api.getComments(s)
    if (Array.isArray(rows)) comments.value = rows
  } catch {
    comments.value = []
  }
}
async function submitComment() {
  const content = commentText.value.trim()
  if (!content || commentPending.value) return
  commentPending.value = true
  const res = await api.addComment(slug.value, content)
  commentPending.value = false
  if (res.ok && res.data.comment) {
    comments.value.push(res.data.comment)
    commentText.value = ''
  }
}
function canDeleteComment(c: PostComment): boolean {
  return c.username === username.value || isAdmin.value
}
async function removeComment(c: PostComment) {
  const res = await api.deleteComment(c.id)
  if (res.ok) comments.value = comments.value.filter((x) => x.id !== c.id)
}

// 文章就绪（静态或 DB 均可）后拉点赞与评论
watch(post, (p) => {
  if (p) {
    loadLikes(slug.value)
    loadComments(slug.value)
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
  refreshDbPosts()
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
    <!-- DB 文章正文加载中 -->
    <div v-if="dbLoading" class="db-post-loading">
      <p class="nf-title">{{ t('blogDetail.loading') }}</p>
    </div>

    <template v-else-if="post">
      <!-- 刊头 -->
      <header class="masthead">
        <p class="masthead-eyebrow">
          {{ post.category }} · {{ post.date }}
          <span v-if="post.isPublished === 0" class="post-draft-badge">{{ t('blog.draft') }}</span>
        </p>
        <h1 class="masthead-title">{{ post.title }}</h1>
        <WriterByline :author="post.author" />
      </header>

      <hr class="rule" />

      <!-- 元数据条 -->
      <div class="post-meta-strip">
        <span class="meta-item">
          <span class="meta-k">{{ t('blogDetail.dateK') }}</span>
          <span class="meta-v">{{ post.date }}</span>
        </span>
        <span class="meta-item">
          <span class="meta-k">{{ t('blogDetail.categoryK') }}</span>
          <span class="meta-v">{{ post.category }}</span>
        </span>
        <span v-if="post.author" class="meta-item">
          <span class="meta-k">{{ t('blogDetail.authorK') }}</span>
          <span class="meta-v">{{ post.author }}</span>
        </span>
        <span v-if="post.readTime" class="meta-item">
          <span class="meta-k">{{ t('blogDetail.readK') }}</span>
          <span class="meta-v">{{ t('blog.readTime', { n: post.readTime }) }}</span>
        </span>
        <span v-if="post.tags.length" class="meta-item meta-tags">
          <span class="meta-k">{{ t('blogDetail.tagsK') }}</span>
          <span class="meta-v">
            <span v-for="tag in post.tags" :key="tag" class="tag">#{{ tag }}</span>
          </span>
        </span>
        <!-- 作者/管理员：编辑与删除 -->
        <span v-if="canManage" class="meta-item meta-manage">
          <button type="button" class="post-manage-btn" @click="router.push(`/blog/compose?slug=${slug}`)">
            {{ t('blog.edit') }}
          </button>
          <button type="button" class="post-manage-btn post-manage-danger" @click="deleteThisPost">
            {{ t('blog.delete') }}
          </button>
        </span>
      </div>

      <!-- 正文 + 右侧目录：正文与互动带共住同一阅读列（同宽同左缘），目录随右 -->
      <div class="article-layout">
        <div class="article-column">
          <article class="markdown-body" v-html="articleHtml"></article>

          <!-- 登录联动：文章尾部的互动带（点赞 + 评论区），与正文同 measure 的"落款带" -->
          <section class="post-engagement" :aria-label="t('blogDetail.engagementAria')">
            <div class="engagement-row">
              <button
                type="button"
                class="like-btn"
                :class="{ liked: likes.liked }"
                :aria-label="likes.liked ? t('blogDetail.unlike') : t('blogDetail.like')"
                :aria-pressed="likes.liked"
                @click="toggleLike"
              >
                <svg viewBox="0 0 24 24" :fill="likes.liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M12 20.25S4.5 15.5 4.5 10.1A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.5c0 5.4-7.5 10.15-7.5 10.15z" />
                </svg>
                <span class="like-count">{{ likes.count }}</span>
              </button>
              <span v-if="!username" class="like-hint">{{ t('blogDetail.likeHint') }}</span>
              <p class="comments-title">{{ t('blogDetail.commentsTitle', { n: comments.length }) }}</p>
            </div>

            <div v-if="comments.length" class="comments-list">
              <div v-for="c in comments" :key="c.id" class="comment-item">
                <p class="comment-head">
                  <span class="comment-user">{{ c.username }}</span>
                  <span class="comment-time">{{ c.createdAt }}</span>
                  <button
                    v-if="canDeleteComment(c)"
                    type="button"
                    class="comment-delete"
                    @click="removeComment(c)"
                  >
                    {{ t('blogDetail.commentDelete') }}
                  </button>
                </p>
                <p class="comment-content">{{ c.content }}</p>
              </div>
            </div>
            <p v-else class="comments-empty">{{ t('blogDetail.noComments') }}</p>

            <form v-if="username" class="comment-form" @submit.prevent="submitComment">
              <label class="comment-label" for="comment-input">{{ t('blogDetail.commentLabel', { name: username }) }}</label>
              <textarea
                id="comment-input"
                v-model="commentText"
                rows="3"
                maxlength="2000"
                :placeholder="t('blogDetail.commentPlaceholder')"
                required
              ></textarea>
              <button type="submit" class="comment-submit" :disabled="commentPending || !commentText.trim()">
                {{ commentPending ? t('blogDetail.commentPending') : t('blogDetail.commentSubmit') }}
              </button>
            </form>
            <p v-else class="comments-login-hint">
              <router-link to="/login">{{ t('blogDetail.loginHintLead') }}</router-link>{{ t('blogDetail.loginHintTail') }}
            </p>
          </section>
        </div>

        <aside v-if="toc.length" class="toc" :aria-label="t('blogDetail.tocAria')">
          <p class="toc-title">{{ t('blogDetail.tocTitle') }}</p>
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
      <nav class="post-nav" :aria-label="t('blogDetail.navAria')">
        <button
          v-if="neighbours.prev"
          type="button"
          class="nav-row"
          @click="go(neighbours.prev.slug)"
        >
          <span class="nav-dir">{{ t('blogDetail.prev') }}</span>
          <span class="nav-title">{{ neighbours.prev.title }}</span>
        </button>
        <span v-else class="nav-row nav-empty" aria-hidden="true"></span>

        <button
          v-if="neighbours.next"
          type="button"
          class="nav-row nav-right"
          @click="go(neighbours.next.slug)"
        >
          <span class="nav-dir">{{ t('blogDetail.next') }}</span>
          <span class="nav-title">{{ neighbours.next.title }}</span>
        </button>
        <span v-else class="nav-row nav-empty" aria-hidden="true"></span>
      </nav>

      <p class="back-link">
        <button type="button" class="back-btn" @click="back">{{ t('blogDetail.back') }}</button>
      </p>
    </template>

    <!-- 文章不存在 -->
    <div v-else class="not-found">
      <p class="nf-title">{{ t('blogDetail.nfTitle') }}</p>
      <p class="nf-desc">{{ t('blogDetail.nfDesc', { slug }) }}</p>
      <button type="button" class="back-btn" @click="back">{{ t('blogDetail.back') }}</button>
    </div>
  </div>
</template>
