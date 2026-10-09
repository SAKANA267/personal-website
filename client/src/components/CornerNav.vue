<script setup lang="ts">
import { useRouter } from 'vue-router'
import AccountMenu from './AccountMenu.vue'
import { useLocale } from '../stores/locale'

// 全站角落导航（App 级，替代各页 TopNav 的文字导航行）：
// 左上角「返回主页」icon（首页自身不显示）+ 右上角语言切换与账号入口（AccountMenu）。
// 挂在 RouterView 之外渲染，fixed 定位不受各页入场动画 transform 的包含块影响。
defineProps<{ showHome: boolean; showAccount: boolean }>()

const router = useRouter()
const { locale, t, setLocale } = useLocale()

// 语言切换：按钮显示目标语言标签（zh 下显示 EN），点击即时切换（纯响应式，不触发遮罩）
function toggleLocale() {
  void setLocale(locale.value === 'zh' ? 'en' : 'zh')
}
</script>

<template>
  <button
    v-if="showHome"
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
  <button
    v-if="showAccount"
    type="button"
    class="corner-lang"
    :aria-label="locale === 'zh' ? t('lang.toEn') : t('lang.toZh')"
    :title="locale === 'zh' ? t('lang.toEn') : t('lang.toZh')"
    @click="toggleLocale"
  >
    {{ locale === 'zh' ? t('lang.labelEn') : t('lang.labelZh') }}
  </button>
  <AccountMenu v-if="showAccount" />
</template>
