<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSearch, type SearchGroupKey, type SearchItem } from '../composables/useSearch'
import { useLocale, type MessageKey } from '../stores/locale'

/**
 * 全站搜索弹窗（Ctrl+K / 导航条搜索按钮唤起）。挂在 App 级 RouterView 之外，
 * fixed 遮罩不受页面入场动画影响。开合本身不动 loading 遮罩（600ms 封面机制照旧），
 * 结果跳转走 router.push，路由级四色块遮罩自然接管。
 * 键盘：Ctrl/Cmd+K 开关、↑↓ 移动、Enter 打开、Esc 关闭并把焦点还给触发元素；
 * 标题卡在场时不响应 Ctrl+K（标题卡有自己的按键推进，避免一次按键双动作）。
 */
const { t } = useLocale()
const route = useRoute()
const router = useRouter()
const {
  open,
  query,
  serverState,
  contentGroups,
  totalResults,
  quickItems,
  fallbackPages,
  isEmpty,
  openSearch,
  closeSearch,
  highlightParts,
} = useSearch()

const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const activeIndex = ref(0)

const GROUP_LABEL: Record<SearchGroupKey, MessageKey> = {
  blog: 'search.groupBlog',
  comments: 'search.groupComments',
  questions: 'search.groupQuestions',
  charts: 'search.groupCharts',
  devlog: 'search.groupDevlog',
  messages: 'search.groupMessages',
  users: 'search.groupUsers',
  pages: 'search.groupPages',
}

const hasQuery = computed(() => query.value.trim().length > 0)

// 少结果兜底组并入展示序列；空 query 时键盘导航对象是快捷入口面板
const visibleGroups = computed(() => {
  const gs = [...contentGroups.value]
  if (hasQuery.value && fallbackPages.value.length) {
    gs.push({ key: 'pages' as SearchGroupKey, items: fallbackPages.value })
  }
  return gs
})

const flatItems = computed<SearchItem[]>(() =>
  hasQuery.value ? visibleGroups.value.flatMap((g) => g.items) : quickItems.value
)

const indexByKey = computed(() => {
  const m = new Map<string, number>()
  flatItems.value.forEach((it, i) => m.set(it.key, i))
  return m
})

watch([flatItems, query], () => {
  activeIndex.value = 0
})

function pick(item: SearchItem) {
  closeSearch(false)
  router.push(item.to)
}

function clearQuery() {
  query.value = ''
  inputEl.value?.focus()
}

// ---------- 全局键盘 ----------

function onDocKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (open.value) {
      closeSearch()
    } else if (!document.querySelector('.page-title-card:not(.is-leaving)')) {
      openSearch(
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      )
    }
    return
  }
  if (!open.value) return
  // 中文输入法组词期间的按键（Enter 上屏/方向键选词）不接手
  if (e.isComposing) return
  if (e.key === 'Escape') {
    closeSearch()
    return
  }
  const count = flatItems.value.length
  if (e.key === 'ArrowDown') {
    if (!count) return
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % count
  } else if (e.key === 'ArrowUp') {
    if (!count) return
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + count) % count
  } else if (e.key === 'Enter') {
    const item = flatItems.value[activeIndex.value]
    if (item) {
      e.preventDefault()
      pick(item)
    }
  }
}

onMounted(() => document.addEventListener('keydown', onDocKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocKeydown))

// 打开即聚焦输入框；路由切换自动收起（跳转后的目标页不残留弹窗，也不抢焦点）
watch(open, (v) => {
  if (v) nextTick(() => inputEl.value?.focus())
})
watch(
  () => route.path,
  () => {
    if (open.value) closeSearch(false)
  }
)

// 键盘导航的活动项滚入可视区
watch(activeIndex, (idx) => {
  listEl.value?.querySelectorAll('.search-item')[idx]?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div v-if="open" class="search-mask" @click.self="closeSearch()">
    <div class="search-dialog" role="dialog" aria-modal="true" :aria-label="t('search.title')">
      <div class="search-head">
        <svg
          class="search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.25" />
          <path d="M15.5 15.5L20.25 20.25" />
        </svg>
        <input
          ref="inputEl"
          v-model="query"
          class="search-input"
          type="search"
          :placeholder="t('search.placeholder')"
          :aria-label="t('search.placeholder')"
          autocomplete="off"
          spellcheck="false"
        />
        <span v-if="serverState === 'loading'" class="search-spinner" aria-hidden="true"></span>
        <button
          v-else-if="query"
          type="button"
          class="search-clear"
          :aria-label="t('search.clear')"
          :title="t('search.clear')"
          @click="clearQuery"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <kbd class="search-kbd" aria-hidden="true">Esc</kbd>
      </div>

      <div v-if="serverState === 'error'" class="search-notice" role="status">
        {{ t('search.serverError') }}
      </div>

      <div ref="listEl" class="search-body" role="listbox" :aria-label="t('search.title')">
        <!-- 空 query：快捷入口面板 -->
        <template v-if="!hasQuery">
          <div class="search-group-title">{{ t('search.quickLinks') }}</div>
          <div class="search-quick-grid">
            <button
              v-for="item in quickItems"
              :key="item.key"
              type="button"
              class="search-quick"
              role="option"
              :aria-selected="indexByKey.get(item.key) === activeIndex"
              :class="{ 'is-active': indexByKey.get(item.key) === activeIndex }"
              @click="pick(item)"
              @mouseenter="activeIndex = indexByKey.get(item.key) ?? 0"
            >
              <span class="search-quick-label">{{ item.title }}</span>
              <span class="search-quick-path">{{ item.to }}</span>
            </button>
          </div>
        </template>

        <template v-else>
          <template v-for="g in visibleGroups" :key="g.key">
            <div class="search-group-title" aria-hidden="true">{{ t(GROUP_LABEL[g.key]) }}</div>
            <button
              v-for="item in g.items"
              :key="item.key"
              type="button"
              class="search-item"
              role="option"
              :aria-selected="indexByKey.get(item.key) === activeIndex"
              :class="{ 'is-active': indexByKey.get(item.key) === activeIndex }"
              @click="pick(item)"
              @mouseenter="activeIndex = indexByKey.get(item.key) ?? 0"
            >
              <span class="search-item-title">
                <template v-for="(part, i) in highlightParts(item.title, query)" :key="i">
                  <mark v-if="part.hit" class="search-hl">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="item.snippet" class="search-item-snippet">
                <template v-for="(part, i) in highlightParts(item.snippet, query)" :key="i">
                  <mark v-if="part.hit" class="search-hl">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="item.meta" class="search-item-meta">{{ item.meta }}</span>
            </button>
          </template>

          <!-- 服务端在途且本地暂无结果：行内加载态（本地结果已出时不占位） -->
          <div v-if="serverState === 'loading' && totalResults === 0" class="search-status">
            {{ t('search.loading') }}
          </div>

          <!-- 空结果兜底：换词建议 + 快捷入口 -->
          <div v-if="isEmpty" class="search-empty">
            <div class="search-empty-title">{{ t('search.empty', { q: query.trim() }) }}</div>
            <p class="search-empty-hint">{{ t('search.emptyHint') }}</p>
            <div class="search-quick-grid">
              <button
                v-for="item in quickItems"
                :key="item.key"
                type="button"
                class="search-quick"
                @click="pick(item)"
              >
                <span class="search-quick-label">{{ item.title }}</span>
                <span class="search-quick-path">{{ item.to }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>

      <div class="search-foot" aria-hidden="true">
        <span class="search-foot-hint"><kbd>↑</kbd><kbd>↓</kbd>{{ t('search.hintSelect') }}</span>
        <span class="search-foot-hint"><kbd>Enter</kbd>{{ t('search.hintOpen') }}</span>
        <span class="search-foot-hint"><kbd>Esc</kbd>{{ t('search.hintClose') }}</span>
        <span class="search-foot-brand">Ctrl K</span>
      </div>
    </div>
  </div>
</template>
