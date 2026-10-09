<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'

// 首页右上角账号入口：单个黑白人形 icon。
// 已登录：点击展开下拉菜单（账号主页 / 退出登录）；未登录：点击直接前往登录页。
const router = useRouter()
const { username, logout } = useAuth()
const { t } = useLocale()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function onTriggerClick() {
  if (!username.value) {
    router.push('/login')
    return
  }
  open.value = !open.value
}

function close() {
  open.value = false
}

async function onLogout() {
  close()
  await logout()
}

function onDocPointerDown(e: PointerEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) close()
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    close()
    ;(rootEl.value?.querySelector('.account-entry-btn') as HTMLElement | null)?.focus()
  }
}

// 登录态变化（退出、启动对账清掉过期缓存）时收起菜单
watch(username, () => close())

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<template>
  <div ref="rootEl" class="account-entry">
    <button
      type="button"
      class="account-entry-btn"
      :class="{ 'is-open': open }"
      :aria-expanded="username ? open : undefined"
      :aria-haspopup="username ? true : undefined"
      :aria-label="username ? t('account.menuAria', { name: username }) : t('account.login')"
      :title="username ? t('account.menuAria', { name: username }) : t('account.login')"
      @click="onTriggerClick"
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
        <circle cx="12" cy="7.75" r="3.75" />
        <path d="M5.25 20.25c0-3.6 3.03-5.25 6.75-5.25s6.75 1.65 6.75 5.25" />
      </svg>
    </button>

    <div v-if="open && username" class="account-entry-menu" role="menu">
      <div class="account-entry-head">
        <p class="account-entry-eyebrow">{{ t('account.signedInAs') }}</p>
        <p class="account-entry-name">{{ username }}</p>
      </div>
      <div class="account-entry-items">
        <button type="button" class="account-entry-item" role="menuitem" @click="router.push('/account')">
          {{ t('account.profile') }}
        </button>
        <button type="button" class="account-entry-item" role="menuitem" @click="onLogout">
          {{ t('account.logout') }}
        </button>
      </div>
    </div>
  </div>
</template>
