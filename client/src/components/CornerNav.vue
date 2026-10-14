<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AccountMenu from './AccountMenu.vue'
import { useLocale } from '../stores/locale'
import { useTheme } from '../stores/theme'

// 全站顶部导航条（App 级，替代各页 TopNav 的文字导航行）：
// 左侧「返回」icon——二级页面（博客阅读/撰写）为「返回博客列表」箭头，其余为返回主页 house icon（首页自身不显示）；
// 右侧黑夜/白天切换、语言切换与账号入口（AccountMenu）。
// 挂在 RouterView 之外渲染，fixed 定位不受各页入场动画 transform 的包含块影响。
// 滚动感知：下滑隐藏、上滑显示、贴顶常显；纸白条状背景 + 发丝线底边，
// 正文经 body padding-top(var(--corner-bar-h)) 让位（标题卡首屏与 /admin 例外，见 global.css §12）。
defineProps<{ showHome: boolean; showAccount: boolean }>()

const route = useRoute()
const router = useRouter()
const { locale, t, setLocale } = useLocale()
const { isDark, toggleTheme } = useTheme()

// /admin 幽灵态：透明无底条只承载图标——管理面板有自己的顶栏体系（admin.css 自留 64px 让位）
const isGhost = computed(() => route.path === '/admin')

// 二级页面（阅读 /blog/:slug、撰写 /blog/compose）左上角换为「返回上一级」：
// 回博客列表而非主页；与 BlogDetailView 底部 back() 同为 push('/blog')，直达链接进入也能返回
const backTo = computed(() =>
  route.path.startsWith('/blog/') ? { to: '/blog', label: t('nav.backToBlog') } : null
)

// 滚动显隐：8px 滞回防抖；聊天消息框等内部滚动盒不改变 window.scrollY，天然不误触发
const navEl = ref<HTMLElement | null>(null)
const navHidden = ref(false)
const SCROLL_DELTA = 8
let lastY = typeof window !== 'undefined' ? window.scrollY : 0

function onScroll() {
  const y = window.scrollY
  const delta = y - lastY
  lastY = y
  if (y <= SCROLL_DELTA) {
    navHidden.value = false // 贴顶常显
    return
  }
  // 账号下拉打开中或指针悬于条上时不隐藏（Safari 点击 button 不聚焦，故查下拉 DOM 而非 :focus-within）
  if (navEl.value?.querySelector('.account-entry-menu') || navEl.value?.matches(':hover')) return
  if (delta > SCROLL_DELTA) navHidden.value = true
  else if (delta < -SCROLL_DELTA) navHidden.value = false
}

// 路由切换重置为显示并对齐基准（SPA 默认保留滚动位置）
watch(
  () => route.path,
  () => {
    lastY = window.scrollY
    navHidden.value = false
  }
)

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

// 语言切换：按钮显示目标语言标签（zh 下显示 EN），点击即时切换（纯响应式，不触发遮罩）
function toggleLocale() {
  void setLocale(locale.value === 'zh' ? 'en' : 'zh')
}

// 黑夜/白天切换：亮色下显示月亮（动作=进入黑夜），暗色下显示太阳——
// 图标与 aria 均指向目标态，与语言切换按钮「显示目标语言」的语义一致
const themeLabel = computed(() => t(isDark.value ? 'nav.toLight' : 'nav.toDark'))
</script>

<template>
  <header
    v-if="showHome || showAccount"
    ref="navEl"
    class="corner-nav"
    :class="{ 'corner-nav--hidden': navHidden, 'corner-nav--ghost': isGhost }"
  >
    <button
      v-if="backTo"
      type="button"
      class="corner-nav-back"
      :aria-label="backTo.label"
      :title="backTo.label"
      @click="router.push(backTo.to)"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M19.25 12H4.75" />
        <path d="M11.25 5.25l-6.5 6.75 6.5 6.75" />
      </svg>
    </button>
    <button
      v-else-if="showHome"
      type="button"
      class="corner-nav-home"
      :aria-label="t('nav.backHome')"
      :title="t('nav.backHome')"
      @click="router.push('/')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4.25 10.75L12 4.25l7.75 6.5" />
        <path d="M6.25 9.5v9a1.25 1.25 0 0 0 1.25 1.25h9a1.25 1.25 0 0 0 1.25-1.25v-9" />
        <path d="M10.25 19.75v-5.5h3.5v5.5" />
      </svg>
    </button>
    <div v-if="showAccount" class="corner-nav-side">
      <button
        type="button"
        class="corner-theme"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="toggleTheme"
      >
        <!-- 月亮（当前亮色，点击入夜）/ 太阳（当前暗色，点击回昼） -->
        <svg
          v-if="!isDark"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
        </svg>
      </button>
      <button
        type="button"
        class="corner-lang"
        :aria-label="locale === 'zh' ? t('lang.toEn') : t('lang.toZh')"
        :title="locale === 'zh' ? t('lang.toEn') : t('lang.toZh')"
        @click="toggleLocale"
      >
        {{ locale === 'zh' ? t('lang.labelEn') : t('lang.labelZh') }}
      </button>
      <AccountMenu />
    </div>
  </header>
</template>
