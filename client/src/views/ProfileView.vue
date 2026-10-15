<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'
import { useCopyText } from '../composables/useCopyText'
import type { BlogPost, ProfileComment, ProfilePrivacy, SocialLink, UserProfile } from '../types'

/**
 * 个人主页（/u/:username，/u/me = 当前登录用户）。
 * 身份三分：本人（完整信息 + 编辑/设置/管理入口）、其他登录用户与游客（仅服务端
 * 隐私裁剪后的公开信息）；未登录访问 /u/me 显示登录引导；用户不存在/已停用/已注销、
 * 主页私密各有明确状态页。设置区（仅本人）承载：编辑资料、头像管理、账号安全
 * （改密/退出/注销）与隐私设置；管理员工具（重置用户密码）沿自原账号页。
 */
const route = useRoute()
const router = useRouter()
const { t, apiError } = useLocale()
const { username, isAdmin, logout } = useAuth()
const { tooltip, copy } = useCopyText()

// ---------- 目标用户与状态机 ----------

const routeParam = computed(() => String(route.params.username ?? ''))
// /u/me：登录用户解析为本人；未登录保持 null（模板优先渲染登录引导态）
const target = computed(() => (routeParam.value === 'me' ? username.value : routeParam.value))
const guestOnOwnPage = computed(() => routeParam.value === 'me' && !username.value)

type Phase = 'loading' | 'ready' | 'error' | 'notfound' | 'unavailable' | 'locked'
const phase = ref<Phase>('loading')
// unavailable 细分（USER_DELETED / USER_DISABLED）
const unavailableCode = ref('')
const profile = ref<UserProfile | null>(null)
// 身份指纹（目标用户 + 是否本人）：变化才重置标签/表单——
// 编辑资料、隐私保存后的重载不切换标签，成功提示与当前表单保持在场
const identityKey = ref('')

async function loadProfile() {
  if (!target.value) return
  phase.value = 'loading'
  const res = await api.getProfile(target.value)
  if (res.ok && res.data.username) {
    const nextKey = `${res.data.username}|${res.data.isSelf}`
    const identityChanged = nextKey !== identityKey.value
    identityKey.value = nextKey
    profile.value = res.data
    phase.value = 'ready'
    applyRobots()
    if (identityChanged) {
      resetTabs()
      if (res.data.isSelf) initPrivacyForm()
    }
    return
  }
  profile.value = null
  if (res.status === 404) phase.value = 'notfound'
  else if (res.status === 410) {
    unavailableCode.value = 'USER_DELETED'
    phase.value = 'unavailable'
  } else if (res.status === 403 && res.data?.error === 'USER_DISABLED') {
    unavailableCode.value = 'USER_DISABLED'
    phase.value = 'unavailable'
  } else if (res.status === 403) phase.value = 'locked'
  else phase.value = 'error'
}

// initAuth 对账完成后 username 才确定（/u/me 冷启动），target 变化即重载
watch(target, loadProfile, { immediate: true })

// 搜索引擎收录开关：allowIndex=false 时给页面挂 noindex（离开页面即摘除）
function applyRobots() {
  if (profile.value?.allowIndex) return
  let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'robots'
    document.head.appendChild(meta)
  }
  meta.content = 'noindex'
}
onBeforeUnmount(() => {
  document.querySelector('meta[name="robots"]')?.remove()
  cancelImage()
})

// ---------- 复制主页链接 ----------

function copyLink(e: MouseEvent) {
  if (!profile.value) return
  const href = router.resolve(`/u/${profile.value.username}`).href
  copy(`${window.location.origin}${href}`, e.clientX, e.clientY)
}

// ---------- 用户图片（头像 / 壁纸） ----------

const USER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']
// 与服务端默认一致（AVATAR_MAX_MB=2 / BANNER_MAX_MB=4）；真实上限由服务端裁决（错误附 maxMb）
const IMAGE_MAX_MB = { avatar: 2, banner: 4 } as const
type ImageKind = 'avatar' | 'banner'

const avatarInput = ref<HTMLInputElement | null>(null)
const bannerInput = ref<HTMLInputElement | null>(null)
const imagePending = ref(false)
const pickedKind = ref<ImageKind>('avatar')
const pickedFile = ref<File | null>(null)
const pickedUrl = ref('')
const imageProgress = ref(-1) // -1 = 未在上传中
const imageError = ref('')

const avatarSrc = computed(() =>
  profile.value?.avatar ? api.avatarUrl(profile.value.avatar) : ''
)
const bannerSrc = computed(() =>
  profile.value?.banner ? api.avatarUrl(profile.value.banner) : ''
)
// 默认头像：昵称/用户名首字（unicode 安全取码点）
const avatarInitial = computed(() => {
  const name = profile.value?.displayName || profile.value?.username || ''
  const first = Array.from(name.trim())[0]
  return (first ?? '?').toUpperCase()
})

function uploadFailKey(kind: ImageKind) {
  return kind === 'avatar' ? 'profile.avatarUploadFail' : 'profile.bannerUploadFail'
}

function pickImage(kind: ImageKind) {
  imageError.value = ''
  const input = kind === 'avatar' ? avatarInput.value : bannerInput.value
  input?.click()
}

function onImagePick(e: Event, kind: ImageKind) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许再次选择同一文件
  if (!file) return
  imageError.value = ''
  if (!USER_IMAGE_TYPES.includes(file.type)) {
    imageError.value = t(kind === 'avatar' ? 'profile.avatarInvalidType' : 'profile.bannerInvalidType')
    return
  }
  const max = IMAGE_MAX_MB[kind]
  if (file.size > max * 1024 * 1024) {
    imageError.value = t(
      kind === 'avatar' ? 'profile.avatarTooLarge' : 'profile.bannerTooLarge',
      { max: `${max}MB` }
    )
    return
  }
  pickedKind.value = kind
  pickedFile.value = file
  pickedUrl.value = URL.createObjectURL(file)
  imagePending.value = true
}

async function confirmImage() {
  const kind = pickedKind.value
  if (!pickedFile.value || imageProgress.value >= 0) return
  imageError.value = ''
  imageProgress.value = 0
  const onProgress = (pct: number) => (imageProgress.value = pct)
  try {
    if (kind === 'avatar') {
      const res = await api.uploadAvatar(pickedFile.value, onProgress)
      if (res.ok && res.data.avatar && profile.value) {
        profile.value.avatar = res.data.avatar
        cancelImage()
      } else {
        // 失败保留所选文件，用户可直接重试
        imageError.value = apiError(res.data, 'profile.avatarUploadFail')
      }
    } else {
      const res = await api.uploadBanner(pickedFile.value, onProgress)
      if (res.ok && res.data.banner && profile.value) {
        profile.value.banner = res.data.banner
        cancelImage()
      } else {
        imageError.value = apiError(res.data, 'profile.bannerUploadFail')
      }
    }
  } catch {
    imageProgress.value = -1
    imageError.value = t(uploadFailKey(kind))
  }
}

function cancelImage() {
  if (pickedUrl.value) URL.revokeObjectURL(pickedUrl.value)
  pickedFile.value = null
  pickedUrl.value = ''
  imagePending.value = false
  imageProgress.value = -1
}

async function removeImage(kind: ImageKind) {
  if (!profile.value) return
  if (kind === 'avatar' && !profile.value.avatar) return
  if (kind === 'banner' && !profile.value.banner) return
  if (!window.confirm(t(kind === 'avatar' ? 'profile.avatarRemoveConfirm' : 'profile.bannerRemoveConfirm')))
    return
  imageError.value = ''
  const res = kind === 'avatar' ? await api.deleteAvatar() : await api.deleteBanner()
  if (res.ok && profile.value) {
    if (kind === 'avatar') profile.value.avatar = null
    else profile.value.banner = null
  } else {
    imageError.value = apiError(res.data, uploadFailKey(kind))
  }
}

// ---------- 编辑资料 ----------

const editing = ref(false)
const editPending = ref(false)
const editError = ref('')
const editNotice = ref('')
const editForm = reactive({
  displayName: '',
  bio: '',
  region: '',
  social: [] as SocialLink[],
})

function startEdit() {
  if (!profile.value) return
  editForm.displayName = profile.value.displayName ?? ''
  editForm.bio = profile.value.bio ?? ''
  editForm.region = profile.value.region ?? ''
  editForm.social =
    profile.value.socialLinks.length > 0
      ? profile.value.socialLinks.map((l) => ({ ...l }))
      : [{ label: '', url: '' }]
  editError.value = ''
  editNotice.value = ''
  editing.value = true
}

function addSocialRow() {
  if (editForm.social.length < 5) editForm.social.push({ label: '', url: '' })
}
function removeSocialRow(i: number) {
  editForm.social.splice(i, 1)
}

async function saveProfile() {
  editError.value = ''
  editNotice.value = ''
  editPending.value = true
  try {
    const res = await api.updateProfile({
      displayName: editForm.displayName,
      bio: editForm.bio,
      region: editForm.region,
      socialLinks: editForm.social.filter((l) => l.label.trim() || l.url.trim()),
    })
    if (res.ok) {
      editNotice.value = t('profile.updated')
      await loadProfile()
      editing.value = false
    } else {
      editError.value = apiError(res.data, 'profile.saveFail')
    }
  } finally {
    editPending.value = false
  }
}

// ---------- 隐私设置 ----------

const privacyForm = reactive<ProfilePrivacy>({
  profilePublic: true,
  showRegion: true,
  showSocial: true,
  showContent: true,
  allowIndex: false,
})
const privacyPending = ref(false)
const privacyError = ref('')
const privacyNotice = ref('')

function initPrivacyForm() {
  const p = profile.value
  if (!p) return
  privacyForm.profilePublic = p.profilePublic
  privacyForm.showRegion = p.regionVisible
  privacyForm.showSocial = p.socialVisible
  privacyForm.showContent = p.contentVisible
  privacyForm.allowIndex = p.allowIndex
}

async function savePrivacy() {
  privacyError.value = ''
  privacyNotice.value = ''
  privacyPending.value = true
  try {
    const res = await api.updatePrivacy({ ...privacyForm })
    if (res.ok) {
      privacyNotice.value = t('profile.privacySaved')
      await loadProfile()
    } else {
      privacyError.value = apiError(res.data, 'profile.privacyFail')
    }
  } finally {
    privacyPending.value = false
  }
}

// ---------- 账号安全：修改密码 / 退出 ----------

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const pwError = ref('')
const pwNotice = ref('')
const pwPending = ref(false)

async function submitPassword() {
  pwError.value = ''
  pwNotice.value = ''
  if (newPassword.value !== confirmPassword.value) {
    pwError.value = t('accountPage.mismatch')
    return
  }
  pwPending.value = true
  try {
    const res = await api.changePassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    if (res.ok) {
      pwNotice.value = t('accountPage.updated')
      oldPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    } else {
      pwError.value = apiError(res.data, 'accountPage.fail')
    }
  } finally {
    pwPending.value = false
  }
}

async function onLogout() {
  await logout()
  router.push('/')
}

// ---------- 注销账号 ----------

const dangerOpen = ref(false)
const dangerPassword = ref('')
const dangerConfirm = ref('')
const dangerError = ref('')
const dangerPending = ref(false)

async function submitDeleteAccount() {
  if (!profile.value) return
  dangerError.value = ''
  if (dangerConfirm.value !== profile.value.username) {
    dangerError.value = t('profile.dangerConfirmMismatch')
    return
  }
  dangerPending.value = true
  try {
    const res = await api.deleteAccount({
      password: dangerPassword.value,
      confirm: dangerConfirm.value,
    })
    if (res.ok) {
      await logout()
      router.push('/')
    } else {
      dangerError.value = apiError(res.data, 'profile.dangerFail')
    }
  } finally {
    dangerPending.value = false
  }
}

// ---------- 管理员工具：重置任意用户密码（沿自原账号页） ----------

const resetTarget = ref('')
const resetPassword = ref('')
const resetConfirm = ref('')
const resetError = ref('')
const resetNotice = ref('')
const resetPending = ref(false)

async function submitReset() {
  resetError.value = ''
  resetNotice.value = ''
  if (resetPassword.value !== resetConfirm.value) {
    resetError.value = t('accountPage.mismatch')
    return
  }
  resetPending.value = true
  try {
    const res = await api.adminResetPassword({
      username: resetTarget.value,
      newPassword: resetPassword.value,
    })
    if (res.ok) {
      resetNotice.value = t('accountPage.adminDone', { name: resetTarget.value })
      resetTarget.value = ''
      resetPassword.value = ''
      resetConfirm.value = ''
    } else {
      resetError.value = apiError(res.data, 'accountPage.adminFail')
    }
  } finally {
    resetPending.value = false
  }
}

// ---------- 内容标签：文章 / 评论 ----------

type Tab = 'posts' | 'comments' | 'settings'
const activeTab = ref<Tab>('posts')

const tabsVisible = computed<Tab[]>(() => {
  const p = profile.value
  if (!p) return []
  const tabs: Tab[] = []
  if (p.contentVisible) tabs.push('posts', 'comments')
  if (p.isSelf) tabs.push('settings')
  return tabs
})

const postsState = reactive({
  rows: [] as BlogPost[],
  total: 0,
  page: 0,
  loaded: false,
  loading: false,
  error: '',
})
const commentsState = reactive({
  rows: [] as ProfileComment[],
  total: 0,
  page: 0,
  loaded: false,
  loading: false,
  error: '',
})
const PAGE_SIZE = 10

function resetTabs() {
  postsState.rows = []
  postsState.total = 0
  postsState.page = 0
  postsState.loaded = false
  postsState.loading = false
  postsState.error = ''
  commentsState.rows = []
  commentsState.total = 0
  commentsState.page = 0
  commentsState.loaded = false
  commentsState.loading = false
  commentsState.error = ''
  activeTab.value = tabsVisible.value[0] ?? 'posts'
  ensureTab()
}

async function loadPosts(reset: boolean) {
  const name = target.value
  if (!name || postsState.loading) return
  postsState.loading = true
  postsState.error = ''
  try {
    const page = reset ? 1 : postsState.page + 1
    const res = await api.getUserPosts(name, page, PAGE_SIZE)
    if (res.ok) {
      postsState.rows = reset ? res.data.rows : [...postsState.rows, ...res.data.rows]
      postsState.total = res.data.total
      postsState.page = page
      postsState.loaded = true
    } else {
      postsState.error = apiError(res.data, 'profile.loadFail')
    }
  } catch {
    postsState.error = t('profile.loadFail')
  } finally {
    postsState.loading = false
  }
}

async function loadComments(reset: boolean) {
  const name = target.value
  if (!name || commentsState.loading) return
  commentsState.loading = true
  commentsState.error = ''
  try {
    const page = reset ? 1 : commentsState.page + 1
    const res = await api.getUserComments(name, page, PAGE_SIZE)
    if (res.ok) {
      commentsState.rows = reset ? res.data.rows : [...commentsState.rows, ...res.data.rows]
      commentsState.total = res.data.total
      commentsState.page = page
      commentsState.loaded = true
    } else {
      commentsState.error = apiError(res.data, 'profile.loadFail')
    }
  } catch {
    commentsState.error = t('profile.loadFail')
  } finally {
    commentsState.loading = false
  }
}

function ensureTab() {
  if (activeTab.value === 'posts' && !postsState.loaded && !postsState.loading) void loadPosts(true)
  if (activeTab.value === 'comments' && !commentsState.loaded && !commentsState.loading)
    void loadComments(true)
}
watch(activeTab, ensureTab)

// 作者/管理员可管理行内内容（编辑删除）
const viewerIsAdmin = isAdmin
function canManage(): boolean {
  return !!profile.value && (profile.value.isSelf || viewerIsAdmin.value)
}

async function removePost(post: BlogPost) {
  if (post.id == null) return
  if (!window.confirm(t('blog.confirmDelete', { title: post.title }))) return
  const res = await api.deletePost(post.id)
  if (res.ok) {
    await Promise.all([loadPosts(true), loadProfile()])
  }
}

async function removeComment(comment: ProfileComment) {
  if (!window.confirm(t('profile.commentDeleteConfirm'))) return
  const res = await api.deleteComment(comment.id)
  if (res.ok) {
    await Promise.all([loadComments(true), loadProfile()])
  }
}
</script>

<template>
  <div class="page-profile">
    <div class="profile-shell">

      <!-- 复制提示，定位到点击坐标，500ms 后淡出（与分享页同一交互） -->
      <div
        class="profile-tooltip"
        :class="{ show: tooltip.show }"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        {{ t('common.copied') }}
      </div>

      <!-- ===== 状态页 ===== -->
      <!-- 未登录访问 /u/me：登录引导 -->
      <div v-if="guestOnOwnPage" class="profile-state">
        <h1 class="profile-state-title">{{ t('profile.loginTitle') }}</h1>
        <p class="profile-state-desc">{{ t('profile.loginDesc') }}</p>
        <button type="button" class="profile-btn profile-btn--primary" @click="router.push('/login')">
          {{ t('account.login') }}
        </button>
      </div>

      <div v-else-if="phase === 'loading'" class="profile-state">
        <p class="profile-state-loading">{{ t('profile.loading') }}</p>
      </div>

      <!-- 网络错误：可重试 -->
      <div v-else-if="phase === 'error'" class="profile-state">
        <h1 class="profile-state-title">{{ t('profile.loadFail') }}</h1>
        <button type="button" class="profile-btn" @click="loadProfile">
          {{ t('profile.retry') }}
        </button>
      </div>

      <!-- 用户不存在 -->
      <div v-else-if="phase === 'notfound'" class="profile-state">
        <h1 class="profile-state-title">{{ t('profile.nfTitle') }}</h1>
        <p class="profile-state-desc">{{ t('profile.nfDesc', { name: routeParam }) }}</p>
      </div>

      <!-- 已注销 / 已停用 -->
      <div v-else-if="phase === 'unavailable'" class="profile-state">
        <h1 class="profile-state-title">{{ t('profile.unavailableTitle') }}</h1>
        <p class="profile-state-desc">
          {{ unavailableCode === 'USER_DELETED' ? t('api.USER_DELETED') : t('api.USER_DISABLED') }}
        </p>
      </div>

      <!-- 主页私密：仅本人可见 -->
      <div v-else-if="phase === 'locked'" class="profile-state">
        <svg class="profile-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5.25" y="10.25" width="13.5" height="9.5" rx="1.5" />
          <path d="M8.25 10.25v-2.5a3.75 3.75 0 0 1 7.5 0v2.5" />
        </svg>
        <h1 class="profile-state-title">{{ t('profile.lockedTitle') }}</h1>
        <p class="profile-state-desc">{{ t('profile.lockedDesc', { name: routeParam }) }}</p>
      </div>

      <!-- ===== 主页主体 ===== -->
      <template v-else-if="profile">

        <!-- 私密提示（本人可见自己的私密主页） -->
        <p v-if="profile.isSelf && !profile.profilePublic" class="profile-private-note">
          {{ t('profile.privateNote') }}
        </p>

        <!-- 个人信息卡片（有壁纸时：顶部条带 + 头像叠下缘；无壁纸不渲染条带，与原布局一致） -->
        <header class="profile-head" :class="{ 'has-banner': !!profile.banner }">
          <!-- 壁纸条带：占内容列宽 × 约 150px 的横幅（非全屏背景），本人悬停可更换 -->
          <div v-if="profile.banner" class="profile-banner-wrap">
            <img class="profile-banner" :src="bannerSrc"
              :alt="t('profile.bannerAlt', { name: profile.username })" />
            <button
              v-if="profile.isSelf"
              type="button"
              class="profile-banner-edit"
              :title="t('profile.changeBanner')"
              :aria-label="t('profile.changeBanner')"
              @click="pickImage('banner')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4.25 8.25h3l1.5-2.5h6.5l1.5 2.5h3v11h-15.5z" />
                <circle cx="11.999" cy="13.5" r="3.25" />
              </svg>
            </button>
            <button
              v-if="profile.isSelf"
              type="button"
              class="profile-banner-remove"
              @click="removeImage('banner')"
            >
              {{ t('profile.removeBanner') }}
            </button>
          </div>
          <!-- 无壁纸时的上传入口（仅本人）：虚线占位条，点击即选图；他人视角不渲染任何占位。
               此前无壁纸时条带与按钮一并 v-if 掉，第一次上传没有可见入口——占位条补上这个空态 -->
          <button
            v-if="profile.isSelf && !profile.banner"
            type="button"
            class="profile-banner-empty"
            @click="pickImage('banner')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4.25 8.25h3l1.5-2.5h6.5l1.5 2.5h3v11h-15.5z" />
              <circle cx="11.999" cy="13.5" r="3.25" />
            </svg>
            {{ t('profile.addBanner') }}
          </button>
          <input
            v-if="profile.isSelf"
            ref="bannerInput"
            type="file"
            class="sr-only"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
            :aria-label="t('profile.changeBanner')"
            @change="onImagePick($event, 'banner')"
          />

          <div class="profile-head-row">
          <div class="profile-avatar-col">
            <div class="profile-avatar-wrap">
              <img v-if="avatarSrc" class="profile-avatar" :src="avatarSrc"
                :alt="t('profile.avatarAlt', { name: profile.username })" />
              <div v-else class="profile-avatar profile-avatar--fallback" aria-hidden="true">
                {{ avatarInitial }}
              </div>
              <!-- 本人：悬停换头像 -->
              <button
                v-if="profile.isSelf"
                type="button"
                class="profile-avatar-edit"
                :title="t('profile.changeAvatar')"
                :aria-label="t('profile.changeAvatar')"
                @click="pickImage('avatar')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4.25 8.25h3l1.5-2.5h6.5l1.5 2.5h3v11h-15.5z" />
                  <circle cx="11.999" cy="13.5" r="3.25" />
                </svg>
              </button>
            </div>
            <input
              v-if="profile.isSelf"
              ref="avatarInput"
              type="file"
              class="sr-only"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              :aria-label="t('profile.changeAvatar')"
              @change="onImagePick($event, 'avatar')"
            />
            <button
              v-if="profile.isSelf && profile.avatar"
              type="button"
              class="profile-avatar-remove"
              @click="removeImage('avatar')"
            >
              {{ t('profile.removeAvatar') }}
            </button>
          </div>

          <div class="profile-id">
            <h1 class="profile-name">{{ profile.displayName || profile.username }}</h1>
            <p class="profile-handle">@{{ profile.username }}</p>
            <p class="profile-joined">{{ t('profile.joined', { date: profile.createdAt }) }}</p>

            <!-- 简介：空则给默认文案（本人提示去补充） -->
            <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
            <p v-else-if="profile.isSelf" class="profile-bio profile-bio--empty">
              {{ t('profile.bioEmptySelf') }}
            </p>

            <!-- 地区 / 社交链接：按隐私开关裁剪；本人视角附「对外隐藏」标记 -->
            <div class="profile-meta">
              <p v-if="profile.region" class="profile-meta-row">
                <span class="profile-meta-label">{{ t('profile.regionLabel') }}</span>
                <span class="profile-meta-value">{{ profile.region }}</span>
                <span v-if="profile.isSelf && !profile.regionVisible" class="profile-vis-chip">
                  {{ t('profile.hiddenFromOthers') }}
                </span>
              </p>
              <p v-if="profile.socialLinks.length" class="profile-meta-row">
                <span class="profile-meta-label">{{ t('profile.socialLabel') }}</span>
                <span class="profile-social">
                  <a v-for="link in profile.socialLinks" :key="link.url" :href="link.url"
                    target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
                </span>
                <span v-if="profile.isSelf && !profile.socialVisible" class="profile-vis-chip">
                  {{ t('profile.hiddenFromOthers') }}
                </span>
              </p>
            </div>

            <!-- 数据概览 -->
            <div class="profile-stats" :aria-label="t('profile.statsAria')">
              <div class="profile-stat">
                <span class="profile-stat-num">{{ profile.stats.posts }}</span>
                <span class="profile-stat-label">{{ t('profile.statPosts') }}</span>
              </div>
              <div class="profile-stat">
                <span class="profile-stat-num">{{ profile.stats.comments }}</span>
                <span class="profile-stat-label">{{ t('profile.statComments') }}</span>
              </div>
              <div class="profile-stat">
                <span class="profile-stat-num">{{ profile.stats.likes }}</span>
                <span class="profile-stat-label">{{ t('profile.statLikes') }}</span>
              </div>
            </div>

            <!-- 动作区：本人编辑资料；所有人可复制链接（私密主页对外本就不可达） -->
            <div class="profile-actions">
              <button v-if="profile.isSelf" type="button" class="profile-btn profile-btn--primary"
                @click="startEdit">
                {{ t('profile.editProfile') }}
              </button>
              <button type="button" class="profile-btn" @click="copyLink">
                {{ t('profile.copyLink') }}
              </button>
            </div>
          </div>
          </div>
        </header>

        <!-- 头像/壁纸上传：预览 → 确认 / 取消（失败保留文件可直接重试） -->
        <section v-if="imagePending" class="profile-card profile-avatar-panel">
          <p class="profile-card-label">
            {{ pickedKind === 'avatar' ? t('profile.avatarPreview') : t('profile.bannerPreview') }}
          </p>
          <div class="profile-avatar-panel-body">
            <img
              v-if="pickedUrl"
              class="profile-image-preview"
              :class="pickedKind === 'banner' ? 'profile-banner--preview' : 'profile-avatar--preview'"
              :src="pickedUrl"
              :alt="pickedKind === 'avatar' ? t('profile.avatarPreview') : t('profile.bannerPreview')"
            />
            <div class="profile-avatar-panel-ops">
              <p v-if="imageProgress >= 0" class="profile-avatar-progress">
                {{ t('profile.avatarUploading', { pct: imageProgress }) }}
              </p>
              <div class="profile-avatar-panel-btns">
                <button type="button" class="profile-btn profile-btn--primary"
                  :disabled="imageProgress >= 0" @click="confirmImage">
                  {{ t('profile.avatarConfirm') }}
                </button>
                <button type="button" class="profile-btn" :disabled="imageProgress >= 0"
                  @click="cancelImage">
                  {{ t('profile.avatarCancel') }}
                </button>
              </div>
              <p v-if="imageError" class="profile-form-error">{{ imageError }}</p>
            </div>
          </div>
        </section>
        <p v-else-if="imageError" class="profile-inline-error">{{ imageError }}</p>

        <!-- ===== 编辑资料（焦点态，替代标签区） ===== -->
        <section v-if="editing" class="profile-card">
          <p class="profile-card-label">{{ t('profile.editSection') }}</p>
          <form class="profile-form" @submit.prevent="saveProfile">
            <div class="profile-field">
              <label for="pf-display">{{ t('profile.displayName') }}</label>
              <input id="pf-display" type="text" v-model="editForm.displayName" maxlength="40"
                :placeholder="profile.username" />
            </div>
            <div class="profile-field">
              <label for="pf-bio">{{ t('profile.bioLabel') }}</label>
              <textarea id="pf-bio" v-model="editForm.bio" maxlength="500" rows="3"
                :placeholder="t('profile.bioPlaceholder')"></textarea>
            </div>
            <div class="profile-field">
              <label for="pf-region">{{ t('profile.regionLabel') }}</label>
              <input id="pf-region" type="text" v-model="editForm.region" maxlength="60"
                :placeholder="t('profile.regionPlaceholder')" />
            </div>

            <div class="profile-field">
              <label>{{ t('profile.socialLabel') }}</label>
              <div v-for="(row, i) in editForm.social" :key="i" class="profile-social-row">
                <input type="text" v-model="row.label" maxlength="30"
                  :placeholder="t('profile.socialLabelPh')" :aria-label="t('profile.socialLabelPh')" />
                <input type="url" v-model="row.url" maxlength="200"
                  :placeholder="t('profile.socialUrlPh')" :aria-label="t('profile.socialUrlPh')" />
                <button type="button" class="profile-icon-btn" :aria-label="t('profile.socialRemove')"
                  :title="t('profile.socialRemove')" @click="removeSocialRow(i)">×</button>
              </div>
              <button v-if="editForm.social.length < 5" type="button" class="profile-linklike"
                @click="addSocialRow">
                + {{ t('profile.socialAdd') }}
              </button>
              <p class="profile-field-hint">{{ t('profile.socialHint') }}</p>
            </div>

            <div class="profile-form-btns">
              <button type="submit" class="profile-btn profile-btn--primary" :disabled="editPending">
                {{ editPending ? t('profile.saving') : t('profile.save') }}
              </button>
              <button type="button" class="profile-btn" @click="editing = false">
                {{ t('profile.cancel') }}
              </button>
            </div>
            <p v-if="editError" class="profile-form-error">{{ editError }}</p>
            <p v-if="editNotice" class="profile-form-notice">{{ editNotice }}</p>
          </form>
        </section>

        <!-- ===== 内容标签区 ===== -->
        <template v-else>
          <nav v-if="tabsVisible.length" class="profile-tabs" :aria-label="t('profile.tabsAria')">
            <button
              v-for="tab in tabsVisible"
              :key="tab"
              type="button"
              class="profile-tab"
              :class="{ active: activeTab === tab }"
              @click="activeTab = tab"
            >
              {{ t(`profile.tab_${tab}`) }}
            </button>
          </nav>

          <!-- 本人关闭了内容展示：温和提示（自己仍可见） -->
          <p v-if="profile.isSelf && !profile.contentVisible" class="profile-private-note">
            {{ t('profile.contentHiddenNote') }}
          </p>

          <!-- 文章 -->
          <div v-if="activeTab === 'posts'" class="profile-panel">
            <template v-if="postsState.rows.length">
              <article v-for="post in postsState.rows" :key="post.id ?? post.slug" class="profile-post">
                <div class="profile-post-main" role="link" tabindex="0"
                  :aria-label="t('blog.readAria', { title: post.title })"
                  @click="router.push(`/blog/${post.slug}`)"
                  @keydown.enter="router.push(`/blog/${post.slug}`)">
                  <p class="profile-post-meta">
                    <span>{{ post.date }}</span>
                    <span class="meta-sep">·</span>
                    <span>{{ post.category }}</span>
                    <span v-if="post.isPublished === 0" class="profile-draft-badge">
                      {{ t('blog.draft') }}
                    </span>
                    <template v-if="post.readTime">
                      <span class="meta-sep">·</span>
                      <span>{{ t('blog.readTime', { n: post.readTime }) }}</span>
                    </template>
                  </p>
                  <h2 class="profile-post-title">{{ post.title }}</h2>
                  <p class="profile-post-excerpt">{{ post.excerpt }}</p>
                </div>
                <div v-if="canManage() && post.id != null" class="profile-row-ops" @click.stop>
                  <button type="button" class="profile-op-btn"
                    @click="router.push(`/blog/compose?slug=${post.slug}`)">
                    {{ t('blog.edit') }}
                  </button>
                  <button type="button" class="profile-op-btn profile-op-btn--danger"
                    @click="removePost(post)">
                    {{ t('blog.delete') }}
                  </button>
                </div>
              </article>
              <button
                v-if="postsState.rows.length < postsState.total"
                type="button"
                class="profile-loadmore"
                :disabled="postsState.loading"
                @click="loadPosts(false)"
              >
                {{ postsState.loading ? t('profile.loadingMore') : t('profile.loadMore') }}
              </button>
            </template>
            <p v-else-if="postsState.loading" class="profile-empty">{{ t('profile.loading') }}</p>
            <p v-else-if="postsState.error" class="profile-empty profile-inline-error">
              {{ postsState.error }}
              <button type="button" class="profile-linklike" @click="loadPosts(true)">
                {{ t('profile.retry') }}
              </button>
            </p>
            <p v-else class="profile-empty">
              {{ profile.isSelf ? t('profile.emptyPostsSelf') : t('profile.emptyPosts') }}
            </p>
          </div>

          <!-- 评论 -->
          <div v-if="activeTab === 'comments'" class="profile-panel">
            <template v-if="commentsState.rows.length">
              <article v-for="comment in commentsState.rows" :key="comment.id" class="profile-comment">
                <div class="profile-comment-main">
                  <p class="profile-comment-content">{{ comment.content }}</p>
                  <p class="profile-comment-meta">
                    <button type="button" class="profile-linklike profile-comment-post"
                      @click="router.push(`/blog/${comment.postSlug}`)">
                      {{ comment.postTitle }}
                    </button>
                    <span class="meta-sep">·</span>
                    <span>{{ comment.createdAt }}</span>
                  </p>
                </div>
                <div v-if="canManage()" class="profile-row-ops" @click.stop>
                  <button type="button" class="profile-op-btn profile-op-btn--danger"
                    @click="removeComment(comment)">
                    {{ t('blog.delete') }}
                  </button>
                </div>
              </article>
              <button
                v-if="commentsState.rows.length < commentsState.total"
                type="button"
                class="profile-loadmore"
                :disabled="commentsState.loading"
                @click="loadComments(false)"
              >
                {{ commentsState.loading ? t('profile.loadingMore') : t('profile.loadMore') }}
              </button>
            </template>
            <p v-else-if="commentsState.loading" class="profile-empty">{{ t('profile.loading') }}</p>
            <p v-else-if="commentsState.error" class="profile-empty profile-inline-error">
              {{ commentsState.error }}
              <button type="button" class="profile-linklike" @click="loadComments(true)">
                {{ t('profile.retry') }}
              </button>
            </p>
            <p v-else class="profile-empty">{{ t('profile.emptyComments') }}</p>
          </div>

          <!-- 设置（仅本人） -->
          <div v-if="activeTab === 'settings' && profile.isSelf" class="profile-panel">

            <!-- 隐私设置 -->
            <section class="profile-card">
              <p class="profile-card-label">{{ t('profile.privacySection') }}</p>
              <form class="profile-form" @submit.prevent="savePrivacy">
                <label class="profile-check">
                  <input type="checkbox" v-model="privacyForm.profilePublic" />
                  <span>{{ t('profile.privPublic') }}</span>
                </label>
                <label class="profile-check">
                  <input type="checkbox" v-model="privacyForm.showRegion" />
                  <span>{{ t('profile.privRegion') }}</span>
                </label>
                <label class="profile-check">
                  <input type="checkbox" v-model="privacyForm.showSocial" />
                  <span>{{ t('profile.privSocial') }}</span>
                </label>
                <label class="profile-check">
                  <input type="checkbox" v-model="privacyForm.showContent" />
                  <span>{{ t('profile.privContent') }}</span>
                </label>
                <label class="profile-check">
                  <input type="checkbox" v-model="privacyForm.allowIndex" />
                  <span>{{ t('profile.privIndex') }}</span>
                </label>
                <div class="profile-form-btns">
                  <button type="submit" class="profile-btn profile-btn--primary"
                    :disabled="privacyPending">
                    {{ privacyPending ? t('profile.saving') : t('profile.privSave') }}
                  </button>
                </div>
                <p v-if="privacyError" class="profile-form-error">{{ privacyError }}</p>
                <p v-if="privacyNotice" class="profile-form-notice">{{ privacyNotice }}</p>
              </form>
            </section>

            <!-- 账号安全：修改密码 -->
            <section class="profile-card">
              <p class="profile-card-label">{{ t('accountPage.section') }}</p>
              <form class="profile-form" @submit.prevent="submitPassword">
                <div class="profile-field">
                  <label for="pf-old">{{ t('accountPage.oldPassword') }}</label>
                  <input id="pf-old" type="password" v-model="oldPassword"
                    autocomplete="current-password" required />
                </div>
                <div class="profile-field">
                  <label for="pf-new">{{ t('accountPage.newPassword') }}</label>
                  <input id="pf-new" type="password" v-model="newPassword"
                    autocomplete="new-password" required minlength="6" />
                  <p class="profile-field-hint">{{ t('accountPage.hint') }}</p>
                </div>
                <div class="profile-field">
                  <label for="pf-confirm">{{ t('accountPage.confirmPassword') }}</label>
                  <input id="pf-confirm" type="password" v-model="confirmPassword"
                    autocomplete="new-password" required minlength="6" />
                </div>
                <div class="profile-form-btns">
                  <button type="submit" class="profile-btn profile-btn--primary" :disabled="pwPending">
                    {{ pwPending ? t('accountPage.pending') : t('accountPage.submit') }}
                  </button>
                </div>
                <p v-if="pwError" class="profile-form-error">{{ pwError }}</p>
                <p v-if="pwNotice" class="profile-form-notice">{{ pwNotice }}</p>
              </form>
              <div class="profile-card-footer">
                <button type="button" class="profile-btn" @click="onLogout">
                  {{ t('account.logout') }}
                </button>
              </div>
            </section>

            <!-- 管理员工具：重置任意用户密码（仅 ADMIN_USERNAMES 白名单） -->
            <section v-if="isAdmin" class="profile-card">
              <p class="profile-card-label">{{ t('accountPage.adminSection') }}</p>
              <form class="profile-form" @submit.prevent="submitReset">
                <div class="profile-field">
                  <label for="pf-reset-target">{{ t('accountPage.adminTarget') }}</label>
                  <input id="pf-reset-target" type="text" v-model="resetTarget" maxlength="255"
                    required />
                </div>
                <div class="profile-field">
                  <label for="pf-reset-pw">{{ t('accountPage.newPassword') }}</label>
                  <input id="pf-reset-pw" type="password" v-model="resetPassword"
                    autocomplete="new-password" required minlength="6" />
                  <p class="profile-field-hint">{{ t('accountPage.hint') }}</p>
                </div>
                <div class="profile-field">
                  <label for="pf-reset-confirm">{{ t('accountPage.confirmPassword') }}</label>
                  <input id="pf-reset-confirm" type="password" v-model="resetConfirm"
                    autocomplete="new-password" required minlength="6" />
                </div>
                <div class="profile-form-btns">
                  <button type="submit" class="profile-btn profile-btn--primary"
                    :disabled="resetPending">
                    {{ resetPending ? t('accountPage.pending') : t('accountPage.adminSubmit') }}
                  </button>
                </div>
                <p v-if="resetError" class="profile-form-error">{{ resetError }}</p>
                <p v-if="resetNotice" class="profile-form-notice">{{ resetNotice }}</p>
              </form>
            </section>

            <!-- 注销账号（危险区） -->
            <section class="profile-card profile-card--danger">
              <p class="profile-card-label">{{ t('profile.dangerSection') }}</p>
              <div v-if="!dangerOpen" class="profile-card-footer">
                <p class="profile-danger-lede">{{ t('profile.dangerLede') }}</p>
                <button type="button" class="profile-btn profile-btn--danger"
                  @click="dangerOpen = true">
                  {{ t('profile.dangerOpen') }}
                </button>
              </div>
              <form v-else class="profile-form" @submit.prevent="submitDeleteAccount">
                <ul class="profile-danger-list">
                  <li>{{ t('profile.dangerItem1') }}</li>
                  <li>{{ t('profile.dangerItem2') }}</li>
                  <li>{{ t('profile.dangerItem3') }}</li>
                </ul>
                <div class="profile-field">
                  <label for="pf-del-pw">{{ t('profile.dangerPassword') }}</label>
                  <input id="pf-del-pw" type="password" v-model="dangerPassword"
                    autocomplete="current-password" required />
                </div>
                <div class="profile-field">
                  <label for="pf-del-confirm">{{ t('profile.dangerConfirmLabel') }}</label>
                  <input
                    id="pf-del-confirm"
                    type="text"
                    v-model="dangerConfirm"
                    :placeholder="profile.username"
                    autocomplete="off"
                    required
                  />
                </div>
                <div class="profile-form-btns">
                  <button type="submit" class="profile-btn profile-btn--danger"
                    :disabled="dangerPending">
                    {{ dangerPending ? t('profile.dangerPending') : t('profile.dangerSubmit') }}
                  </button>
                  <button type="button" class="profile-btn" @click="dangerOpen = false">
                    {{ t('profile.cancel') }}
                  </button>
                </div>
                <p v-if="dangerError" class="profile-form-error">{{ dangerError }}</p>
              </form>
            </section>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
