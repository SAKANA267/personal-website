<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminPager from '../components/AdminPager.vue'
import {
  adminApi,
  type AdminListQuery,
  type AdminPaged,
  type AdminOverview,
  type AdminPost,
  type AdminShare,
  type AdminUser,
} from '../composables/useAdminApi'
import { useAuth } from '../stores/auth'

/**
 * 管理面板（/admin，仅 ADMIN_USERNAMES 白名单可见）：侧栏标签式工作台。
 * 定位是工具而非门面——服务端分页 + 按标签缓存数据 + 操作后就地更新行数据，
 * 样式独立于站点设计体系（.admin-app 前缀），文案为内部工具中文、不走 i18n。
 */

const route = useRoute()
const router = useRouter()
const { username } = useAuth()

// ---------- 标签页 ----------

type TabKey = 'overview' | 'messages' | 'posts' | 'comments' | 'shares' | 'users' | 'logs' | 'devlog'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'messages', label: '留言板' },
  { key: 'posts', label: '博客文章' },
  { key: 'comments', label: '评论' },
  { key: 'shares', label: '分享' },
  { key: 'users', label: '用户' },
  { key: 'logs', label: '聊天日志' },
  { key: 'devlog', label: '开发日志' },
]
const TAB_TITLE: Record<TabKey, string> = {
  overview: '站点概览',
  messages: '留言板管理',
  posts: '博客文章管理',
  comments: '评论管理',
  shares: '分享管理',
  users: '用户管理',
  logs: '聊天日志',
  devlog: '开发日志',
}

const activeTab = ref<TabKey>('overview')

// ---------- 通用分页列表（各标签独立实例，切走不清空 = 天然缓存） ----------

interface ListState<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  q: string
  loading: boolean
  loaded: boolean
  error: string | null
}

function createList<T>(fetcher: (query: AdminListQuery) => Promise<AdminPaged<T>>) {
  // rows 元素是纯数据对象；reactive 的 UnwrapRef 泛型映射与外部 T 不兼容，断言回原类型
  const st = reactive({
    rows: [] as T[],
    total: 0,
    page: 1,
    pageSize: 20,
    q: '',
    loading: false,
    loaded: false,
    error: null as string | null,
  }) as ListState<T>
  async function load(reset = false) {
    if (reset) st.page = 1
    st.loading = true
    st.error = null
    try {
      const data = await fetcher({ page: st.page, pageSize: st.pageSize, q: st.q })
      st.rows = data.rows
      st.total = data.total
      st.page = data.page
      st.pageSize = data.pageSize
      st.loaded = true
    } catch (e: unknown) {
      st.error = (e as Error)?.message || 'REQUEST_FAILED'
    } finally {
      st.loading = false
    }
  }
  return { st, load }
}

const messagesList = createList(adminApi.messages)
const postsList = createList(adminApi.posts)
const commentsList = createList(adminApi.comments)
const sharesList = createList(adminApi.shares)
const usersList = createList(adminApi.users)
const logsList = createList(adminApi.logs)
const devlogList = createList(adminApi.devlog)

// 供标签切换/顶栏刷新按钮统一取用（rows 用 any[]：各列表自身类型在上面已收紧）
interface AnyList {
  st: { rows: any[]; total: number; page: number; pageSize: number; q: string; loading: boolean; loaded: boolean; error: string | null }
  load: (reset?: boolean) => Promise<void>
}
const lists: Record<Exclude<TabKey, 'overview'>, AnyList> = {
  messages: messagesList,
  posts: postsList,
  comments: commentsList,
  shares: sharesList,
  users: usersList,
  logs: logsList,
  devlog: devlogList,
}

// 当前标签对应的列表（概览标签为 null）
const activeList = computed<AnyList | null>(() =>
  activeTab.value === 'overview' ? null : lists[activeTab.value]
)

// ---------- 概览 ----------

const overview = ref<AdminOverview | null>(null)
const overviewLoading = ref(false)
const overviewError = ref<string | null>(null)

async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = null
  try {
    overview.value = await adminApi.overview()
  } catch (e: unknown) {
    overviewError.value = (e as Error)?.message || 'REQUEST_FAILED'
  } finally {
    overviewLoading.value = false
  }
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`
  return `${Math.floor(sec / 86400)} 天 ${Math.floor((sec % 86400) / 3600)} 小时`
}

// ---------- 轻提示 ----------

const toast = ref<{ text: string; kind: 'ok' | 'err' } | null>(null)
let toastTimer: number | undefined

function notify(text: string, kind: 'ok' | 'err' = 'ok') {
  toast.value = { text, kind }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2600)
}

function errText(e: unknown): string {
  return (e as Error)?.message || 'REQUEST_FAILED'
}

// ---------- 各标签动作（操作成功后就地改行数据，不整页重拉） ----------

async function toggleMessage(m: { id: number; is_displayed: number }) {
  const target: 0 | 1 = m.is_displayed === 1 ? 0 : 1
  const res = await adminApi.setMessageDisplayed(m.id, target)
  if (res.ok && res.data?.success) {
    m.is_displayed = target
    notify(target === 1 ? '留言已恢复显示' : '留言已隐藏')
  } else {
    notify(`操作失败（${res.data?.error ?? res.status}）`, 'err')
  }
}

async function togglePublish(p: AdminPost) {
  const target: 0 | 1 = p.isPublished === 1 ? 0 : 1
  try {
    await adminApi.setPostPublished(p.id, target)
    p.isPublished = target
    notify(target === 1 ? '文章已发布' : '文章已下线为草稿')
  } catch (e: unknown) {
    notify(`操作失败（${errText(e)}）`, 'err')
  }
}

async function removePost(p: AdminPost) {
  if (!window.confirm(`确定删除文章《${p.title}》？其评论与点赞将一并删除。`)) return
  const res = await adminApi.deletePost(p.id)
  if (res.ok && res.data?.success) {
    postsList.st.rows = postsList.st.rows.filter((r) => r.id !== p.id)
    postsList.st.total -= 1
    notify('文章已删除')
  } else {
    notify(`删除失败（${res.data?.error ?? res.status}）`, 'err')
  }
}

async function removeComment(c: { id: number; username: string }) {
  if (!window.confirm(`确定删除 ${c.username} 的这条评论？`)) return
  const res = await adminApi.deleteComment(c.id)
  if (res.ok && res.data?.success) {
    commentsList.st.rows = commentsList.st.rows.filter((r) => r.id !== c.id)
    commentsList.st.total -= 1
    notify('评论已删除')
  } else {
    notify(`删除失败（${res.data?.error ?? res.status}）`, 'err')
  }
}

async function removeShare(s: AdminShare) {
  if (!window.confirm(`确定删除分享「${s.title}」（取件码 ${s.code}）？文件将一并清理。`)) return
  const res = await adminApi.deleteShare(s.code)
  if (res.ok && res.data?.success) {
    sharesList.st.rows = sharesList.st.rows.filter((r) => r.id !== s.id)
    sharesList.st.total -= 1
    notify('分享已删除')
  } else {
    notify(`删除失败（${res.data?.error ?? res.status}）`, 'err')
  }
}

async function cleanupShares() {
  if (!window.confirm('清理所有已过期的分享（连同磁盘文件）？')) return
  try {
    const r = await adminApi.cleanupShares()
    notify(`已清理 ${r.removed} 条过期分享`)
    void sharesList.load()
  } catch (e: unknown) {
    notify(`清理失败（${errText(e)}）`, 'err')
  }
}

// 重置密码（复用 /api/auth/admin/reset-password）
const resetTarget = ref<AdminUser | null>(null)
const resetPassword = ref('')
const resetSubmitting = ref(false)

async function submitReset() {
  const target = resetTarget.value
  if (!target) return
  if (resetPassword.value.length < 6) {
    notify('新密码至少 6 位', 'err')
    return
  }
  resetSubmitting.value = true
  const res = await adminApi.adminResetPassword({ username: target.username, newPassword: resetPassword.value })
  resetSubmitting.value = false
  if (res.ok && res.data?.success) {
    notify(`已重置 ${target.username} 的密码`)
    resetTarget.value = null
    resetPassword.value = ''
  } else {
    notify(`重置失败（${res.data?.error ?? res.status}）`, 'err')
  }
}

// 开发日志新增（追加制，列表即时刷新）
const devlogDraft = ref('')
const devlogSubmitting = ref(false)

async function submitDevlog() {
  const content = devlogDraft.value.trim()
  if (!content) return
  devlogSubmitting.value = true
  const res = await adminApi.postDevLog({ content })
  const data = (res.data ?? {}) as { success?: boolean; error?: string }
  devlogSubmitting.value = false
  if (res.ok && !data.error) {
    devlogDraft.value = ''
    notify('开发日志已记录')
    void devlogList.load(true)
  } else {
    notify(`提交失败（${data.error ?? res.status}）`, 'err')
  }
}

// ---------- 标签切换 / 深链（?tab=） ----------

function ensureLoaded(key: TabKey) {
  if (key === 'overview') {
    if (!overview.value && !overviewLoading.value) void loadOverview()
  } else {
    const l = lists[key]
    if (!l.st.loaded && !l.st.loading) void l.load()
  }
}

function switchTab(key: TabKey) {
  if (activeTab.value === key) return
  activeTab.value = key
  router.replace({ query: { ...route.query, tab: key === 'overview' ? undefined : key } })
  ensureLoaded(key)
}

onMounted(() => {
  const t = String(route.query.tab ?? 'overview') as TabKey
  activeTab.value = TABS.some((x) => x.key === t) ? t : 'overview'
  ensureLoaded(activeTab.value)
})

// ---------- 展示工具 ----------

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const SHARE_TYPE_LABEL: Record<AdminShare['type'], string> = { text: '文字', image: '图片', file: '文件' }
</script>

<template>
  <div class="admin-app">
    <!-- 侧栏 -->
    <aside class="admin-side">
      <div class="admin-brand">
        <span class="admin-brand-seal" aria-hidden="true">管</span>
        <span>
          <span class="admin-brand-mark">SAKANA</span>
          <span class="admin-brand-sub">管理面板</span>
        </span>
      </div>
      <nav class="admin-nav" aria-label="管理面板导航">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="admin-nav-item"
          :class="{ active: activeTab === tab.key }"
          @click="switchTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="admin-side-foot">
        <p class="admin-side-line">{{ username ?? '—' }}</p>
        <RouterLink class="admin-side-link" to="/">← 返回站点</RouterLink>
      </div>
    </aside>

    <!-- 主区 -->
    <main class="admin-main">
      <header class="admin-topbar">
        <h1 class="admin-title">{{ TAB_TITLE[activeTab] }}</h1>
        <div class="admin-topbar-actions">
          <button v-if="activeList" type="button" class="admin-btn ghost" @click="activeList.load()">
            刷新
          </button>
          <button v-else type="button" class="admin-btn ghost" @click="loadOverview()">刷新</button>
        </div>
      </header>

      <section class="admin-body">
        <!-- ===== 概览 ===== -->
        <div v-if="activeTab === 'overview'" class="admin-pane">
          <p v-if="overviewLoading && !overview" class="admin-hint">加载中…</p>
          <p v-else-if="overviewError" class="admin-hint danger">加载失败：{{ overviewError }}</p>
          <template v-else-if="overview">
            <div class="admin-stats">
              <button type="button" class="admin-stat" @click="switchTab('messages')">
                <span class="admin-stat-num">{{ overview.counts.messages }}</span>
                <span class="admin-stat-label">留言
                  <em v-if="overview.counts.messagesHidden > 0" class="admin-stat-sub">
                    {{ overview.counts.messagesHidden }} 条隐藏
                  </em>
                </span>
              </button>
              <button type="button" class="admin-stat" @click="switchTab('users')">
                <span class="admin-stat-num">{{ overview.counts.users }}</span>
                <span class="admin-stat-label">用户</span>
              </button>
              <button type="button" class="admin-stat" @click="switchTab('posts')">
                <span class="admin-stat-num">{{ overview.counts.posts }}</span>
                <span class="admin-stat-label">用户文章
                  <em v-if="overview.counts.postsDraft > 0" class="admin-stat-sub">
                    {{ overview.counts.postsDraft }} 篇草稿
                  </em>
                </span>
              </button>
              <button type="button" class="admin-stat" @click="switchTab('comments')">
                <span class="admin-stat-num">{{ overview.counts.comments }}</span>
                <span class="admin-stat-label">评论</span>
              </button>
              <div class="admin-stat">
                <span class="admin-stat-num">{{ overview.counts.likes }}</span>
                <span class="admin-stat-label">点赞</span>
              </div>
              <button type="button" class="admin-stat" @click="switchTab('shares')">
                <span class="admin-stat-num">{{ overview.counts.sharesActive }}</span>
                <span class="admin-stat-label">有效分享
                  <em class="admin-stat-sub">共 {{ overview.counts.shares }}</em>
                </span>
              </button>
              <button type="button" class="admin-stat" @click="switchTab('devlog')">
                <span class="admin-stat-num">{{ overview.counts.devlog }}</span>
                <span class="admin-stat-label">开发日志</span>
              </button>
              <button type="button" class="admin-stat" @click="switchTab('logs')">
                <span class="admin-stat-num">{{ overview.counts.logs }}</span>
                <span class="admin-stat-label">聊天日志</span>
              </button>
            </div>

            <div class="admin-overview-grid">
              <div class="admin-panel">
                <h2 class="admin-panel-title">最新留言</h2>
                <ul class="admin-recent">
                  <li v-for="m in overview.recentMessages" :key="m.id" class="admin-recent-item">
                    <span class="admin-recent-meta">
                      <b>{{ m.name }}</b>
                      <time>{{ m.timestamp }}</time>
                      <em v-if="m.is_displayed === 0" class="admin-tag danger">已隐藏</em>
                    </span>
                    <span class="admin-recent-text">{{ m.message }}</span>
                  </li>
                  <li v-if="!overview.recentMessages.length" class="admin-empty-inline">暂无留言</li>
                </ul>
              </div>
              <div class="admin-panel">
                <h2 class="admin-panel-title">最近聊天动态</h2>
                <ul class="admin-recent">
                  <li v-for="l in overview.recentLogs" :key="l.id" class="admin-recent-item">
                    <span class="admin-recent-meta">
                      <b>{{ l.sender }}</b>
                      <time>{{ l.timestamp }}</time>
                    </span>
                    <span class="admin-recent-text">{{ l.message }}</span>
                  </li>
                  <li v-if="!overview.recentLogs.length" class="admin-empty-inline">暂无记录</li>
                </ul>
              </div>
            </div>

            <p class="admin-server-line">
              服务运行 {{ formatUptime(overview.server.uptimeSec) }} · Node {{ overview.server.nodeVersion }} ·
              数据截至 {{ overview.server.now.replace('T', ' ').slice(0, 16) }}
            </p>
          </template>
        </div>

        <!-- ===== 留言板 ===== -->
        <div v-else-if="activeTab === 'messages'" class="admin-pane">
          <div class="admin-toolbar">
            <input
              v-model="messagesList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索昵称 / 内容…"
              @keyup.enter="messagesList.load(true)"
            />
            <button type="button" class="admin-btn" @click="messagesList.load(true)">搜索</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-id">ID</th>
                  <th class="col-name">昵称</th>
                  <th>内容</th>
                  <th class="col-time">时间</th>
                  <th class="col-state">状态</th>
                  <th class="col-op">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in messagesList.st.rows" :key="m.id">
                  <td class="col-id">{{ m.id }}</td>
                  <td class="col-name">{{ m.name }}</td>
                  <td class="admin-cell-clip">{{ m.message }}</td>
                  <td class="col-time">{{ m.timestamp }}</td>
                  <td class="col-state">
                    <span class="admin-tag" :class="m.is_displayed === 1 ? 'ok' : 'danger'">
                      {{ m.is_displayed === 1 ? '显示' : '已隐藏' }}
                    </span>
                  </td>
                  <td class="col-op">
                    <button type="button" class="admin-btn sm" @click="toggleMessage(m)">
                      {{ m.is_displayed === 1 ? '隐藏' : '恢复' }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!messagesList.st.loading && !messagesList.st.error && !messagesList.st.rows.length">
                  <td colspan="6" class="admin-empty">暂无留言</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="messagesList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="messagesList.st.error" class="admin-hint danger">加载失败：{{ messagesList.st.error }}</p>
          <AdminPager
            :page="messagesList.st.page"
            :page-size="messagesList.st.pageSize"
            :total="messagesList.st.total"
            :loading="messagesList.st.loading"
            @go="(p) => { messagesList.st.page = p; messagesList.load() }"
            @size="(s) => { messagesList.st.pageSize = s; messagesList.load(true) }"
          />
        </div>

        <!-- ===== 博客文章 ===== -->
        <div v-else-if="activeTab === 'posts'" class="admin-pane">
          <div class="admin-toolbar">
            <input
              v-model="postsList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索标题 / 作者…"
              @keyup.enter="postsList.load(true)"
            />
            <button type="button" class="admin-btn" @click="postsList.load(true)">搜索</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-id">ID</th>
                  <th>标题</th>
                  <th class="col-author">作者</th>
                  <th class="col-cat">分类</th>
                  <th class="col-time">日期</th>
                  <th class="col-num">评论</th>
                  <th class="col-num">赞</th>
                  <th class="col-state">状态</th>
                  <th class="col-op">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in postsList.st.rows" :key="p.id">
                  <td class="col-id">{{ p.id }}</td>
                  <td class="admin-cell-clip">
                    <RouterLink class="admin-link" :to="`/blog/${p.slug}`" :title="p.title">{{ p.title }}</RouterLink>
                  </td>
                  <td class="col-author">{{ p.author }}</td>
                  <td class="col-cat">{{ p.category }}</td>
                  <td class="col-time">{{ p.date }}</td>
                  <td class="col-num">{{ p.commentCount }}</td>
                  <td class="col-num">{{ p.likeCount }}</td>
                  <td class="col-state">
                    <span class="admin-tag" :class="p.isPublished === 1 ? 'ok' : 'muted'">
                      {{ p.isPublished === 1 ? '已发布' : '草稿' }}
                    </span>
                  </td>
                  <td class="col-op">
                    <button type="button" class="admin-btn sm" @click="togglePublish(p)">
                      {{ p.isPublished === 1 ? '下线' : '发布' }}
                    </button>
                    <RouterLink class="admin-btn sm ghost" :to="`/blog/compose?slug=${p.slug}`">编辑</RouterLink>
                    <button type="button" class="admin-btn sm danger" @click="removePost(p)">删除</button>
                  </td>
                </tr>
                <tr v-if="!postsList.st.loading && !postsList.st.error && !postsList.st.rows.length">
                  <td colspan="9" class="admin-empty">暂无文章</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="postsList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="postsList.st.error" class="admin-hint danger">加载失败：{{ postsList.st.error }}</p>
          <AdminPager
            :page="postsList.st.page"
            :page-size="postsList.st.pageSize"
            :total="postsList.st.total"
            :loading="postsList.st.loading"
            @go="(p) => { postsList.st.page = p; postsList.load() }"
            @size="(s) => { postsList.st.pageSize = s; postsList.load(true) }"
          />
        </div>

        <!-- ===== 评论 ===== -->
        <div v-else-if="activeTab === 'comments'" class="admin-pane">
          <div class="admin-toolbar">
            <input
              v-model="commentsList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索用户 / 内容 / 文章…"
              @keyup.enter="commentsList.load(true)"
            />
            <button type="button" class="admin-btn" @click="commentsList.load(true)">搜索</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-id">ID</th>
                  <th class="col-author">用户</th>
                  <th>内容</th>
                  <th class="col-slug">文章</th>
                  <th class="col-time">时间</th>
                  <th class="col-op">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in commentsList.st.rows" :key="c.id">
                  <td class="col-id">{{ c.id }}</td>
                  <td class="col-author">{{ c.username }}</td>
                  <td class="admin-cell-clip">{{ c.content }}</td>
                  <td class="col-slug">
                    <RouterLink class="admin-link" :to="`/blog/${c.post_slug}`">{{ c.post_slug }}</RouterLink>
                  </td>
                  <td class="col-time">{{ c.createdAt }}</td>
                  <td class="col-op">
                    <button type="button" class="admin-btn sm danger" @click="removeComment(c)">删除</button>
                  </td>
                </tr>
                <tr v-if="!commentsList.st.loading && !commentsList.st.error && !commentsList.st.rows.length">
                  <td colspan="6" class="admin-empty">暂无评论</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="commentsList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="commentsList.st.error" class="admin-hint danger">加载失败：{{ commentsList.st.error }}</p>
          <AdminPager
            :page="commentsList.st.page"
            :page-size="commentsList.st.pageSize"
            :total="commentsList.st.total"
            :loading="commentsList.st.loading"
            @go="(p) => { commentsList.st.page = p; commentsList.load() }"
            @size="(s) => { commentsList.st.pageSize = s; commentsList.load(true) }"
          />
        </div>

        <!-- ===== 分享 ===== -->
        <div v-else-if="activeTab === 'shares'" class="admin-pane">
          <div class="admin-toolbar">
            <input
              v-model="sharesList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索标题 / 取件码 / 上传者…"
              @keyup.enter="sharesList.load(true)"
            />
            <button type="button" class="admin-btn" @click="sharesList.load(true)">搜索</button>
            <button type="button" class="admin-btn ghost" @click="cleanupShares">清理过期</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-code">取件码</th>
                  <th class="col-cat">类型</th>
                  <th>标题</th>
                  <th class="col-size">大小</th>
                  <th class="col-author">上传者</th>
                  <th class="col-num">浏览</th>
                  <th class="col-num">下载</th>
                  <th class="col-time">过期</th>
                  <th class="col-state">状态</th>
                  <th class="col-op">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in sharesList.st.rows" :key="s.id">
                  <td class="col-code">{{ s.code }}</td>
                  <td class="col-cat">{{ SHARE_TYPE_LABEL[s.type] }}</td>
                  <td class="admin-cell-clip">
                    <RouterLink class="admin-link" :to="`/share/${s.code}`" :title="s.title">{{ s.title }}</RouterLink>
                  </td>
                  <td class="col-size">{{ formatSize(s.size) }}</td>
                  <td class="col-author">{{ s.uploaderUser ?? `游客 ${s.uploaderIp ?? ''}` }}</td>
                  <td class="col-num">{{ s.views }}</td>
                  <td class="col-num">{{ s.downloads }}</td>
                  <td class="col-time">{{ s.expiresAt ?? '永久' }}</td>
                  <td class="col-state">
                    <span class="admin-tag" :class="s.expired ? 'danger' : 'ok'">
                      {{ s.expired ? '已过期' : '有效' }}
                    </span>
                  </td>
                  <td class="col-op">
                    <button type="button" class="admin-btn sm danger" @click="removeShare(s)">删除</button>
                  </td>
                </tr>
                <tr v-if="!sharesList.st.loading && !sharesList.st.error && !sharesList.st.rows.length">
                  <td colspan="10" class="admin-empty">暂无分享</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="sharesList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="sharesList.st.error" class="admin-hint danger">加载失败：{{ sharesList.st.error }}</p>
          <AdminPager
            :page="sharesList.st.page"
            :page-size="sharesList.st.pageSize"
            :total="sharesList.st.total"
            :loading="sharesList.st.loading"
            @go="(p) => { sharesList.st.page = p; sharesList.load() }"
            @size="(s) => { sharesList.st.pageSize = s; sharesList.load(true) }"
          />
        </div>

        <!-- ===== 用户 ===== -->
        <div v-else-if="activeTab === 'users'" class="admin-pane">
          <div class="admin-toolbar">
            <input
              v-model="usersList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索用户名…"
              @keyup.enter="usersList.load(true)"
            />
            <button type="button" class="admin-btn" @click="usersList.load(true)">搜索</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-id">ID</th>
                  <th class="col-author">用户名</th>
                  <th class="col-num">文章</th>
                  <th class="col-num">评论</th>
                  <th class="col-num">点赞</th>
                  <th class="col-num">分享</th>
                  <th class="col-op">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in usersList.st.rows" :key="u.id">
                  <td class="col-id">{{ u.id }}</td>
                  <td class="col-author">{{ u.username }}</td>
                  <td class="col-num">{{ u.posts }}</td>
                  <td class="col-num">{{ u.comments }}</td>
                  <td class="col-num">{{ u.likes }}</td>
                  <td class="col-num">{{ u.shares }}</td>
                  <td class="col-op">
                    <button
                      type="button"
                      class="admin-btn sm"
                      @click="resetTarget = u; resetPassword = ''"
                    >
                      重置密码
                    </button>
                  </td>
                </tr>
                <tr v-if="!usersList.st.loading && !usersList.st.error && !usersList.st.rows.length">
                  <td colspan="7" class="admin-empty">暂无用户</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="usersList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="usersList.st.error" class="admin-hint danger">加载失败：{{ usersList.st.error }}</p>
          <AdminPager
            :page="usersList.st.page"
            :page-size="usersList.st.pageSize"
            :total="usersList.st.total"
            :loading="usersList.st.loading"
            @go="(p) => { usersList.st.page = p; usersList.load() }"
            @size="(s) => { usersList.st.pageSize = s; usersList.load(true) }"
          />
        </div>

        <!-- ===== 聊天日志 ===== -->
        <div v-else-if="activeTab === 'logs'" class="admin-pane">
          <div class="admin-toolbar">
            <input
              v-model="logsList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索发送者 / 内容…"
              @keyup.enter="logsList.load(true)"
            />
            <button type="button" class="admin-btn" @click="logsList.load(true)">搜索</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-id">ID</th>
                  <th class="col-author">发送者</th>
                  <th>内容</th>
                  <th class="col-time">时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in logsList.st.rows" :key="l.id">
                  <td class="col-id">{{ l.id }}</td>
                  <td class="col-author">{{ l.sender }}</td>
                  <td class="admin-cell-clip">{{ l.message }}</td>
                  <td class="col-time">{{ l.timestamp }}</td>
                </tr>
                <tr v-if="!logsList.st.loading && !logsList.st.error && !logsList.st.rows.length">
                  <td colspan="4" class="admin-empty">暂无记录</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="logsList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="logsList.st.error" class="admin-hint danger">加载失败：{{ logsList.st.error }}</p>
          <AdminPager
            :page="logsList.st.page"
            :page-size="logsList.st.pageSize"
            :total="logsList.st.total"
            :loading="logsList.st.loading"
            @go="(p) => { logsList.st.page = p; logsList.load() }"
            @size="(s) => { logsList.st.pageSize = s; logsList.load(true) }"
          />
        </div>

        <!-- ===== 开发日志 ===== -->
        <div v-else-if="activeTab === 'devlog'" class="admin-pane">
          <form class="admin-devlog-form" @submit.prevent="submitDevlog">
            <textarea
              v-model="devlogDraft"
              class="admin-input admin-textarea"
              rows="2"
              maxlength="5000"
              placeholder="记录一条变更（时间由数据库生成）…"
            ></textarea>
            <button type="submit" class="admin-btn" :disabled="!devlogDraft.trim() || devlogSubmitting">
              {{ devlogSubmitting ? '提交中…' : '新增日志' }}
            </button>
          </form>
          <div class="admin-toolbar">
            <input
              v-model="devlogList.st.q"
              class="admin-input admin-search"
              type="search"
              placeholder="搜索内容…"
              @keyup.enter="devlogList.load(true)"
            />
            <button type="button" class="admin-btn" @click="devlogList.load(true)">搜索</button>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th class="col-id">ID</th>
                  <th class="col-time">时间</th>
                  <th>变更描述</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in devlogList.st.rows" :key="d.id">
                  <td class="col-id">{{ d.id }}</td>
                  <td class="col-time">{{ d.timestamp }}</td>
                  <td class="admin-cell-clip">{{ d.change_description }}</td>
                </tr>
                <tr v-if="!devlogList.st.loading && !devlogList.st.error && !devlogList.st.rows.length">
                  <td colspan="3" class="admin-empty">暂无日志</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="devlogList.st.loading" class="admin-hint">加载中…</p>
          <p v-if="devlogList.st.error" class="admin-hint danger">加载失败：{{ devlogList.st.error }}</p>
          <AdminPager
            :page="devlogList.st.page"
            :page-size="devlogList.st.pageSize"
            :total="devlogList.st.total"
            :loading="devlogList.st.loading"
            @go="(p) => { devlogList.st.page = p; devlogList.load() }"
            @size="(s) => { devlogList.st.pageSize = s; devlogList.load(true) }"
          />
        </div>
      </section>
    </main>

    <!-- 轻提示 -->
    <Transition name="admin-toast">
      <div v-if="toast" class="admin-toast" :class="toast.kind" role="status">{{ toast.text }}</div>
    </Transition>

    <!-- 重置密码对话框 -->
    <div v-if="resetTarget" class="admin-modal-mask" @click.self="resetTarget = null">
      <div class="admin-modal" role="dialog" aria-modal="true" aria-label="重置密码">
        <h2 class="admin-modal-title">重置 {{ resetTarget.username }} 的密码</h2>
        <p class="admin-modal-hint">请线下核实对方身份后操作；新密码至少 6 位，重置后告知用户自行修改。</p>
        <input
          v-model="resetPassword"
          class="admin-input"
          type="text"
          placeholder="新密码（至少 6 位）"
          autocomplete="off"
          @keyup.enter="submitReset"
        />
        <div class="admin-modal-actions">
          <button type="button" class="admin-btn ghost" :disabled="resetSubmitting" @click="resetTarget = null">
            取消
          </button>
          <button type="button" class="admin-btn" :disabled="resetSubmitting" @click="submitReset">
            {{ resetSubmitting ? '提交中…' : '确认重置' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
