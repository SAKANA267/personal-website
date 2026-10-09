<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../composables/useApi'
import { renderMarkdown } from '../composables/useMarkdown'
import { refreshDbPosts, mergedPosts } from '../composables/useBlogPosts'
import { useAuth } from '../stores/auth'
import type { BlogPost } from '../types'

// 博客撰写页（登录联动）：新建或编辑自己的文章（?slug=u-xxx）。
// 正文 Markdown，服务端派生摘要/阅读时长；支持草稿（仅作者可见）与发布。
// 登录门槛由路由守卫保证；编辑权限双重校验：客户端预检不预填他人文章，服务端 PUT 再把关。
const route = useRoute()
const router = useRouter()
const { username, isAdmin } = useAuth()

const editSlug = computed(() => {
  const s = String(route.query.slug ?? '')
  return s.startsWith('u-') ? s : ''
})

const title = ref('')
const category = ref('')
const tagsInput = ref('')
const body = ref('')
const showPreview = ref(false)
const pending = ref(false)
const error = ref('')
const loaded = ref(!editSlug.value)
// 编辑模式：onMounted 拉到的目标文章（含 id 与作者）
const editing = ref<BlogPost | null>(null)

onMounted(async () => {
  if (!editSlug.value) return
  const res = await api.getDbPost(editSlug.value)
  if (res.ok && res.data?.slug) {
    const p = res.data as BlogPost
    // 已发布文章的详情接口对所有人开放，这里客户端先挡一道：非作者/管理员不预填
    if (p.author && p.author !== username.value && !isAdmin.value) {
      error.value = '只能编辑自己的文章'
    } else {
      editing.value = p
      title.value = p.title
      category.value = p.category
      tagsInput.value = (p.tags || []).join(', ')
      body.value = p.body ?? ''
    }
  } else {
    error.value = res.data?.error || '文章不存在或无权编辑'
  }
  loaded.value = true
})

// 分类建议：现有文章的分类去重
const categoryOptions = computed(() => {
  const set = new Set<string>()
  for (const p of mergedPosts()) if (p.category) set.add(p.category)
  return Array.from(set)
})

const previewHtml = computed(() =>
  showPreview.value && body.value.trim() ? renderMarkdown(body.value).html : ''
)

// 稿面计数：字符数 + 预估阅读时长（与服务端 deriveReadTime 同一套算法）
const bodyStats = computed(() => {
  const text = body.value
  const cjk = (text.match(/\p{Script=Han}/gu) || []).length
  const words = (text.replace(/\p{Script=Han}/gu, ' ').match(/[A-Za-z0-9]+/g) || []).length
  const minutes = Math.max(1, Math.round(cjk / 400 + words / 200))
  return `${text.length} 字符 · 约 ${minutes} min`
})

async function save(publish: 0 | 1) {
  if (pending.value) return
  error.value = ''
  if (!title.value.trim() || !body.value.trim()) {
    error.value = '标题与正文不能为空'
    return
  }
  pending.value = true
  const payload = {
    title: title.value.trim(),
    category: category.value.trim() || '随笔',
    tags: tagsInput.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 8),
    body: body.value,
    is_published: publish,
  }
  const res = editing.value?.id != null
    ? await api.updatePost(editing.value.id, payload)
    : await api.createPost(payload)
  pending.value = false
  if (res.ok && res.data.post) {
    await refreshDbPosts()
    router.push(`/blog/${res.data.post.slug}`)
  } else {
    error.value = res.data?.error || (res.status === 403 ? '无权修改这篇文章' : '保存失败，请稍后再试')
  }
}

function cancel() {
  router.back()
}
</script>

<template>
  <div class="page-compose">
    <header class="compose-head">
      <p class="masthead-eyebrow">{{ editSlug ? 'EDIT POST' : 'NEW POST' }}</p>
      <h1 class="masthead-title">{{ editSlug ? '编辑文章' : '写文章' }}</h1>
    </header>

    <hr class="rule" />

    <p v-if="!loaded" class="compose-status">载入中…</p>

    <!-- 编辑他人文章 / 文章不存在：只显示错误与返回，不给误存为新文章的机会 -->
    <div v-else-if="error && editSlug" class="compose-status">
      <p class="compose-error">{{ error }}</p>
      <button type="button" class="compose-btn-ghost" @click="router.push('/blog')">← 返回博客</button>
    </div>

    <form v-else class="compose-form" @submit.prevent="save(1)">
      <div class="compose-field">
        <label class="compose-label" for="compose-title">标题</label>
        <input id="compose-title" v-model="title" type="text" maxlength="120" placeholder="文章标题" required />
      </div>

      <div class="compose-row">
        <div class="compose-field">
          <label class="compose-label" for="compose-category">分类</label>
          <input id="compose-category" v-model="category" type="text" maxlength="32" list="category-options" placeholder="随笔" />
          <datalist id="category-options">
            <option v-for="c in categoryOptions" :key="c" :value="c" />
          </datalist>
        </div>
        <div class="compose-field">
          <label class="compose-label" for="compose-tags">标签（逗号分隔，最多 8 个）</label>
          <input id="compose-tags" v-model="tagsInput" type="text" placeholder="vue, design" />
        </div>
      </div>

      <div class="compose-field">
        <div class="compose-body-toolbar">
          <label class="compose-label" for="compose-body">正文（Markdown）</label>
          <button type="button" class="compose-preview-toggle" :class="{ active: showPreview }" @click="showPreview = !showPreview">
            {{ showPreview ? '编辑' : '预览' }}
          </button>
        </div>
        <textarea
          v-show="!showPreview"
          id="compose-body"
          v-model="body"
          rows="18"
          placeholder="用 Markdown 写下正文…"
          required
        ></textarea>
        <!-- 稿面计数：与服务端派生逻辑同源（中文 400 字/分 + 英文 200 词/分） -->
        <p v-show="!showPreview" class="compose-stats">{{ bodyStats }}</p>
        <div v-if="showPreview" class="compose-preview">
          <p class="compose-preview-eyebrow">PREVIEW</p>
          <div class="markdown-body" v-html="previewHtml"></div>
        </div>
      </div>

      <p v-if="error" class="compose-error">{{ error }}</p>

      <div class="compose-actions">
        <button type="button" class="compose-btn-ghost" :disabled="pending" @click="cancel">取消</button>
        <button type="button" class="compose-btn-ghost" :disabled="pending" @click="save(0)">存草稿</button>
        <button type="submit" class="compose-btn-submit" :disabled="pending">
          {{ pending ? '保存中…' : (editSlug ? '保存修改' : '发布') }}
        </button>
      </div>
      <p class="compose-hint">草稿仅自己可见；摘要与阅读时长由服务端自动生成。</p>
    </form>
  </div>
</template>
