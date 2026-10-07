<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useCopyText } from '../composables/useCopyText'
import { useAuth } from '../stores/auth'
import type { ShareItem } from '../types'

const route = useRoute()
const router = useRouter()
const { tooltip, copy } = useCopyText()
// Login adaptation: after login, show the "My Shares" management list
const { username } = useAuth()

// 与 server 端 SHARE_MAX_MB（默认 20）一致的提示文案
const MAX_MB_LABEL = '20MB'

// ===== 路由模式：/share 上传，/share/:code 扫码取件（同一组件复用，watch 参数）=====
const code = computed(() => {
  const c = route.params.code
  return typeof c === 'string' ? c : ''
})

// ===== 上传模式状态 =====
type Tab = 'text' | 'image' | 'file'
const tab = ref<Tab>('text')
const textContent = ref('')
const pickedFile = ref<File | null>(null)
const dragover = ref(false)
const expiresIn = ref('7d')
const uploading = ref(false)
const progress = ref(0)
const error = ref('')
const result = ref<ShareItem | null>(null)
const shareUrl = ref('')
const qrDataUrl = ref('')

const EXPIRY_OPTIONS = [
  { value: '1h', label: '1 小时' },
  { value: '1d', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '', label: '永久' },
]

const canSubmit = computed(() =>
  tab.value === 'text' ? textContent.value.trim().length > 0 : pickedFile.value !== null
)

// ===== 取件模式状态 =====
const item = ref<ShareItem | null>(null)
const loadState = ref<'loading' | 'ready' | 'missing' | 'expired'>('loading')
const imgFailed = ref(false)
const previewUrl = computed(() => (item.value ? api.shareFileUrl(item.value.code) : ''))

async function loadShare() {
  if (!code.value) return
  loadState.value = 'loading'
  item.value = null
  imgFailed.value = false
  try {
    const res = await api.getShare(code.value)
    if (res.ok) {
      item.value = res.data
      loadState.value = 'ready'
    } else if (res.status === 410) {
      loadState.value = 'expired'
    } else {
      loadState.value = 'missing'
    }
  } catch {
    loadState.value = 'missing'
  }
}
watch(code, loadShare, { immediate: true })

// ===== 上传交互 =====
function switchTab(next: Tab) {
  if (tab.value === next) return
  tab.value = next
  pickedFile.value = null
  error.value = ''
}

function acceptType() {
  return tab.value === 'image' ? 'image/*' : ''
}

function validatePicked(file: File): string | null {
  if (tab.value === 'image' && !file.type.startsWith('image/')) return '所选文件不是图片'
  return null
}

function pickFile(file: File | undefined | null) {
  if (!file) return
  const problem = validatePicked(file)
  if (problem) {
    error.value = problem
    return
  }
  error.value = ''
  pickedFile.value = file
}

function triggerPick() {
  document.getElementById('share-file-input')?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  pickFile(input.files?.[0])
  input.value = '' // 允许再次选择同一文件
}

function onDrop(e: DragEvent) {
  dragover.value = false
  pickFile(e.dataTransfer?.files?.[0])
}

function clearFile() {
  pickedFile.value = null
}

async function submit() {
  if (uploading.value || !canSubmit.value) return
  error.value = ''
  uploading.value = true
  progress.value = 0
  try {
    const exp = expiresIn.value || null
    const res =
      tab.value === 'text'
        ? await api.createTextShare({ content: textContent.value, expiresIn: exp })
        : await api.createFileShare(pickedFile.value!, tab.value, exp, (p) => (progress.value = p))
    if (res.ok && res.data?.item) {
      result.value = res.data.item
      await makeQr(res.data.item)
      if (username.value) fetchMyShares() // 登录状态下新分享计入"我的分享"
    } else {
      error.value = res.data?.error || '分享失败，请稍后再试。'
    }
  } catch (e: any) {
    error.value = e?.message || '分享失败，请稍后再试。'
  } finally {
    uploading.value = false
  }
}

async function makeQr(target: ShareItem) {
  // 二维码内容 = 取件页绝对链接（dev/prod 均由当前地址 + base 推导）
  shareUrl.value = `${window.location.origin}${import.meta.env.BASE_URL}share/${target.code}`
  qrDataUrl.value = ''
  try {
    qrDataUrl.value = await QRCode.toDataURL(shareUrl.value, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
  } catch (e) {
    console.error('QRCode generation failed:', e)
  }
}

function shareAnother() {
  result.value = null
  qrDataUrl.value = ''
  shareUrl.value = ''
  textContent.value = ''
  pickedFile.value = null
  error.value = ''
}

// ===== My Shares (login adaptation) =====
const myShares = ref<ShareItem[]>([])
const myLoading = ref(false)

async function fetchMyShares() {
  if (!username.value) {
    myShares.value = []
    return
  }
  myLoading.value = true
  try {
    const data = await api.getMyShares()
    myShares.value = Array.isArray(data) ? data : []
  } catch {
    myShares.value = []
  } finally {
    myLoading.value = false
  }
}

// Show/hide with login state; refresh the list after successful upload
watch(username, fetchMyShares, { immediate: true })

async function removeShare(code: string) {
  const res = await api.deleteShare(code)
  if (res.ok) fetchMyShares()
}

// ===== 结果面板交互 =====
function copyLink(e: MouseEvent) {
  copy(shareUrl.value, e.clientX, e.clientY)
}

function openReceive() {
  if (result.value) router.push(`/share/${result.value.code}`)
}

function downloadQr() {
  if (!qrDataUrl.value) return
  const a = document.createElement('a')
  a.href = qrDataUrl.value
  a.download = `qrcode-share-${result.value?.code || ''}.png`
  a.click()
}

// ===== 取件页交互 =====
function copyContent(e: MouseEvent) {
  if (item.value?.content != null) copy(item.value.content, e.clientX, e.clientY)
}

function downloadItem() {
  if (!item.value) return
  const a = document.createElement('a')
  a.href = api.shareDownloadUrl(item.value.code)
  a.download = item.value.title
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ===== 展示辅助 =====
function typeLabel(target: ShareItem) {
  return target.type === 'text' ? '文字' : target.type === 'image' ? '图片' : '文件'
}

function formatSize(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function remainText(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return '已过期'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `剩 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `剩 ${hours} 小时`
  return `剩 ${Math.floor(hours / 24)} 天`
}

function expiryLabel() {
  return EXPIRY_OPTIONS.find((o) => o.value === expiresIn.value)?.label ?? '永久'
}

function extLabel(target: ShareItem) {
  const dot = target.title.lastIndexOf('.')
  return dot > -1 ? target.title.slice(dot + 1).toUpperCase() : 'FILE'
}
</script>

<template>
  <div class="page-share">

    <div class="container">
      <h1>二维码分享</h1>
      <WriterByline />
    </div>

    <!-- ===== 上传模式 ===== -->
    <template v-if="!code">
      <!-- 生成结果：二维码 + 链接 -->
      <section v-if="result" class="share-panel share-result">
        <h2>分享已生成</h2>
        <div class="result-grid">
          <div class="result-qr-box">
            <img v-if="qrDataUrl" class="result-qr" :src="qrDataUrl" alt="分享二维码" />
            <p v-else class="result-qr-fallback">二维码生成失败，可直接复制下方链接</p>
          </div>
          <div class="result-info">
            <p class="result-code">取件码：{{ result.code }}</p>
            <p class="result-title">{{ result.title }}</p>
            <p class="result-meta">
              {{ typeLabel(result) }}<template v-if="result.size != null"> · {{ formatSize(result.size) }}</template> · 有效期：{{ expiryLabel() }}
            </p>
            <p class="result-link" title="点击复制链接" @click="copyLink">{{ shareUrl }}</p>
            <div class="result-actions">
              <p class="action-btn" @click="copyLink">复制链接</p>
              <p class="action-btn primary" @click="openReceive">打开取件页</p>
              <p class="action-btn" @click="downloadQr">保存二维码</p>
            </div>
          </div>
        </div>
        <p class="share-again" @click="shareAnother">← 再分享一个</p>
      </section>

      <!-- 上传表单 -->
      <section v-else class="share-panel">
        <div class="share-tabs">
          <p class="share-tab" :class="{ active: tab === 'text' }" @click="switchTab('text')">文字</p>
          <p class="share-tab" :class="{ active: tab === 'image' }" @click="switchTab('image')">图片</p>
          <p class="share-tab" :class="{ active: tab === 'file' }" @click="switchTab('file')">文件</p>
        </div>

        <div v-if="tab === 'text'" class="share-body">
          <textarea
            v-model="textContent"
            class="share-textarea"
            placeholder="粘贴或输入要分享的文字…"
          ></textarea>
        </div>

        <div v-else class="share-body">
          <div
            class="share-dropzone"
            :class="{ 'is-dragover': dragover }"
            @click="triggerPick"
            @dragover.prevent="dragover = true"
            @dragleave.prevent="dragover = false"
            @drop.prevent="onDrop"
          >
            <p class="dropzone-main">{{ tab === 'image' ? '点击或拖入图片' : '点击或拖入文件' }}</p>
            <p class="dropzone-sub">单个文件不超过 {{ MAX_MB_LABEL }}</p>
          </div>
          <div v-if="pickedFile" class="picked-file">
            <span class="picked-name">{{ pickedFile.name }}</span>
            <span class="picked-size">{{ formatSize(pickedFile.size) }}</span>
            <span class="picked-remove" @click="clearFile">移除</span>
          </div>
          <input
            id="share-file-input"
            type="file"
            :accept="acceptType()"
            class="share-hidden-input"
            @change="onFileChange"
          />
        </div>

        <div class="share-options">
          <label for="share-expiry">有效期</label>
          <select id="share-expiry" v-model="expiresIn">
            <option v-for="opt in EXPIRY_OPTIONS" :key="opt.label" :value="opt.value">{{ opt.label }}</option>
          </select>
          <p class="action-btn primary share-submit" :class="{ disabled: uploading || !canSubmit }" @click="submit">
            {{ uploading ? '上传中…' : '生成二维码' }}
          </p>
        </div>

        <div v-if="uploading" class="share-progress">
          <div class="share-progress-track">
            <div class="share-progress-bar" :style="{ width: progress + '%' }"></div>
          </div>
          <span class="share-progress-text">{{ progress }}%</span>
        </div>

        <p v-if="error" class="share-error">{{ error }}</p>
      </section>

      <!-- ===== 我的分享（登录适配）：本人分享记录与删除 ===== -->
      <section v-if="username" class="share-panel share-mine">
        <h2>我的分享</h2>
        <p v-if="myLoading" class="mine-state">加载中…</p>
        <p v-else-if="myShares.length === 0" class="mine-state">还没有分享记录</p>
        <div v-else class="mine-list">
          <div v-for="s in myShares" :key="s.code" class="mine-item">
            <span class="mine-code">{{ s.code }}</span>
            <span class="mine-title">{{ s.title }}</span>
            <span class="mine-meta">
              {{ typeLabel(s) }} · {{ formatDate(s.createdAt) }}<template v-if="s.expiresAt"> · {{ remainText(s.expiresAt) }}</template>
            </span>
            <span class="mine-actions">
              <span class="action-btn" @click="router.push(`/share/${s.code}`)">查看</span>
              <span class="action-btn danger" @click="removeShare(s.code)">删除</span>
            </span>
          </div>
        </div>
      </section>
    </template>

    <!-- ===== 取件模式 ===== -->
    <section v-else class="share-panel share-receive">
      <div v-if="loadState === 'loading'" class="receive-state">加载中…</div>

      <div v-else-if="loadState === 'missing'" class="receive-state">
        <p class="state-main">分享不存在</p>
        <p class="state-sub">链接可能有误，或内容已被删除</p>
      </div>

      <div v-else-if="loadState === 'expired'" class="receive-state">
        <p class="state-main">分享已过期</p>
        <p class="state-sub">该内容超出有效期，已被清理</p>
      </div>

      <template v-else-if="item">
        <div class="receive-head">
          <p class="receive-title">{{ item.title }}</p>
          <p class="receive-meta">
            {{ typeLabel(item) }} · {{ formatSize(item.size) }} · {{ formatDate(item.createdAt) }}<template v-if="item.expiresAt"> · {{ remainText(item.expiresAt) }}</template>
          </p>
        </div>

        <!-- 文字：直接展示 -->
        <div v-if="item.type === 'text'" class="receive-text">{{ item.content }}</div>

        <!-- 图片：内联预览 -->
        <div v-else-if="item.type === 'image'" class="receive-image-box">
          <img
            v-if="!imgFailed"
            class="receive-image"
            :src="previewUrl"
            :alt="item.title"
            @error="imgFailed = true"
          />
          <p v-else class="state-sub">图片加载失败，可尝试下方下载</p>
        </div>

        <!-- 文件：扩展名徽标 -->
        <div v-else class="receive-file">
          <span class="file-badge">{{ extLabel(item) }}</span>
        </div>

        <div class="receive-actions">
          <p v-if="item.type === 'text'" class="action-btn" @click="copyContent">复制内容</p>
          <p class="action-btn primary" @click="downloadItem">
            下载{{ item.type === 'text' ? '为 TXT' : item.type === 'image' ? '图片' : '文件' }}
          </p>
        </div>

        <p class="receive-counts">已被查看 {{ item.views }} 次 · 下载 {{ item.downloads }} 次</p>
      </template>
    </section>

    <!-- 复制提示，定位到点击坐标，500ms 后淡出 -->
    <div
      class="share-tooltip"
      :class="{ show: tooltip.show }"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      已复制
    </div>
  </div>
</template>
