<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../composables/useApi'
import { renderMarkdown, formatBytes } from '../composables/useMarkdown'
import { refreshDbPosts, mergedPosts, parseFrontmatter, parseTags } from '../composables/useBlogPosts'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'
import type { BlogPost } from '../types'

// 博客撰写页（登录联动）：新建或编辑自己的文章（?slug=u-xxx）。
// 正文 Markdown，服务端派生摘要/阅读时长；支持草稿（仅作者可见）与发布。
// 登录门槛由路由守卫保证；编辑权限双重校验：客户端预检不预填他人文章，服务端 PUT 再把关。
// 工具增强：插图上传（multipart 带进度，插入 ![说明](url)）与 .md 文件本地导入（免网页编辑器）。
const route = useRoute()
const router = useRouter()
const { username, isAdmin } = useAuth()
const { t, apiError } = useLocale()

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
      error.value = t('compose.notOwner')
    } else {
      editing.value = p
      title.value = p.title
      category.value = p.category
      tagsInput.value = (p.tags || []).join(', ')
      body.value = p.body ?? ''
    }
  } else {
    error.value = apiError(res.data, 'compose.notFoundOrForbidden')
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
  return t('compose.stats', { chars: text.length, minutes })
})

async function save(publish: 0 | 1) {
  if (pending.value) return
  error.value = ''
  if (!title.value.trim() || !body.value.trim()) {
    error.value = t('compose.emptyError')
    return
  }
  pending.value = true
  const payload = {
    title: title.value.trim(),
    category: category.value.trim() || t('compose.defaultCategory'),
    tags: tagsInput.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
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
    error.value =
      res.status === 403 ? t('compose.forbidden') : apiError(res.data, 'compose.saveFail')
  }
}

function cancel() {
  router.back()
}

// ---------- 插图上传（安全校验服务端兜底，这里先做体验性预检） ----------

// 与服务端 BLOG_IMAGE_MAX_MB 默认值（8）保持一致；服务端改配置时以错误返回的 maxMb 为准
const IMAGE_MAX_MB = 8
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif'
const IMAGE_TYPES = new Set(IMAGE_ACCEPT.split(','))

// .md 导入上限：1MB 读取上限（正文另有 5 万字符限制，与服务端 POST_BODY_INVALID 对齐）
const MD_MAX_BYTES = 1024 * 1024
const MD_MAX_CHARS = 50000

interface ImageDraft {
  file: File
  caption: string
  pct: number
  uploading: boolean
  name?: string
  size?: number // 原图字节数
  displaySize?: number | null // 展示变体字节数（null = 未压缩）
  error?: string
}

const bodyTextarea = ref<HTMLTextAreaElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const mdInput = ref<HTMLInputElement | null>(null)
const imageDraft = ref<ImageDraft | null>(null)
// 导入 .md 成功等非错误提示（与 error 分开显示）
const notice = ref('')
// 面板代次：取消/重选后自增，让在途上传回调失效（完成后自动删除孤儿文件）
let imageSeq = 0

function pickImage() {
  imageInput.value?.click()
}

function pickMd() {
  mdInput.value?.click()
}

function onImageChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 复位，允许再次选择同一文件
  if (!file) return
  error.value = ''
  notice.value = ''
  // 预检：类型（SVG 可携带脚本，服务端同样拒绝）与大小；最终裁决在服务端魔数嗅探
  if (!IMAGE_TYPES.has(file.type)) {
    error.value = apiError({ error: 'BLOG_IMAGE_INVALID_TYPE' }, 'compose.imageFail')
    return
  }
  if (file.size > IMAGE_MAX_MB * 1024 * 1024) {
    error.value = apiError({ error: 'BLOG_IMAGE_TOO_LARGE', maxMb: IMAGE_MAX_MB }, 'compose.imageFail')
    return
  }
  const seq = ++imageSeq
  imageDraft.value = { file, caption: '', pct: 0, uploading: true }
  void (async () => {
    let uploadedName: string | undefined
    try {
      const res = await api.uploadBlogImage(file, (pct) => {
        const d = imageDraft.value
        if (d && imageSeq === seq) d.pct = pct
      })
      uploadedName = res.ok ? res.data.image?.name : undefined
      const d = imageDraft.value
      if (imageSeq !== seq) {
        // 上传期间面板被取消/替换：不留孤儿
        if (uploadedName) void api.deleteBlogImage(uploadedName)
        return
      }
      d!.uploading = false
      if (uploadedName) {
        d!.name = uploadedName
        d!.size = res.data.image?.size
        d!.displaySize = res.data.image?.displaySize ?? null
      } else {
        d!.error = apiError(res.data, 'compose.imageFail')
      }
    } catch {
      const d = imageDraft.value
      if (imageSeq === seq && d) {
        d.uploading = false
        d.error = t('compose.imageFail')
      }
    }
  })()
}

/** 说明文字转义后拼进 Markdown（] 会截断 alt，成对转义）。 */
function insertImage() {
  const draft = imageDraft.value
  if (!draft?.name) return
  const caption = draft.caption.trim().replace(/([[\\]])/g, '\\$1')
  const md = `\n\n![${caption}](${api.blogImageUrl(draft.name)})\n\n`
  imageDraft.value = null
  insertAtCursor(md)
}

function cancelImage() {
  const draft = imageDraft.value
  imageSeq++ // 在途上传的回调随之失效（完成后如已落库会自动删除孤儿）
  imageDraft.value = null
  // 已上传成功又取消：删掉服务端文件，避免孤儿占用配额
  if (draft?.name) void api.deleteBlogImage(draft.name)
}

/** 在正文光标处插入文本（无焦点/无选区时追加到末尾），插入后光标落在文本之后。 */
function insertAtCursor(text: string) {
  const ta = bodyTextarea.value
  if (!ta) {
    body.value += text
    return
  }
  const start = ta.selectionStart ?? body.value.length
  const end = ta.selectionEnd ?? start
  body.value = body.value.slice(0, start) + text + body.value.slice(end)
  const pos = start + text.length
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(pos, pos)
  })
}

// ---------- .md 文件导入（本地读取，不上传原文件；内容仍经 POST /api/blog 正常校验） ----------

async function onMdChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''
  notice.value = ''
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) {
    error.value = t('compose.mdInvalidType')
    return
  }
  if (file.size > MD_MAX_BYTES) {
    error.value = t('compose.mdTooLarge')
    return
  }
  let text: string
  try {
    text = await file.text() // 按 UTF-8 解码
  } catch {
    error.value = t('compose.mdReadFail')
    return
  }
  text = text.replace(/^\uFEFF/, '') // 去 BOM
  if (text.length > MD_MAX_CHARS) {
    error.value = t('compose.mdTooManyChars', { max: MD_MAX_CHARS })
    return
  }
  const { meta, body: mdBody } = parseFrontmatter(text)
  body.value = mdBody.trim()
  if (meta.title) {
    title.value = meta.title
  } else {
    // 无 frontmatter 标题：取正文首个一级标题，否则用文件名
    const h1 = mdBody.match(/^\s*#\s+(.+)$/m)
    title.value = (h1?.[1] ?? file.name.replace(/\.(md|markdown)$/i, '')).trim().slice(0, 120)
  }
  if (meta.category) category.value = meta.category
  if (meta.tags !== undefined && meta.tags.trim()) {
    tagsInput.value = parseTags(meta.tags).slice(0, 8).join(', ')
  }
  notice.value = t('compose.mdImported')
}
</script>

<template>
  <div class="page-compose">
    <header class="compose-head">
      <div class="compose-head-main">
        <p class="masthead-eyebrow">{{ editSlug ? t('compose.eyebrowEdit') : t('compose.eyebrowNew') }}</p>
        <h1 class="masthead-title">{{ editSlug ? t('compose.titleEdit') : t('compose.titleNew') }}</h1>
      </div>
      <!-- .md 直接导入：本地读取填充表单，不想用网页编辑器的作者可在本地写好再导入 -->
      <button type="button" class="compose-import-btn" @click="pickMd">{{ t('compose.importMd') }}</button>
    </header>

    <hr class="rule" />

    <p v-if="!loaded" class="compose-status">{{ t('compose.loading') }}</p>

    <!-- 编辑他人文章 / 文章不存在：只显示错误与返回，不给误存为新文章的机会 -->
    <div v-else-if="error && editSlug" class="compose-status">
      <p class="compose-error">{{ error }}</p>
      <button type="button" class="compose-btn-ghost" @click="router.push('/blog')">{{ t('compose.back') }}</button>
    </div>

    <form v-else class="compose-form" @submit.prevent="save(1)">
      <div class="compose-field">
        <label class="compose-label" for="compose-title">{{ t('compose.titleLabel') }}</label>
        <input id="compose-title" v-model="title" type="text" maxlength="120" :placeholder="t('compose.titlePlaceholder')" required />
      </div>

      <div class="compose-row">
        <div class="compose-field">
          <label class="compose-label" for="compose-category">{{ t('compose.categoryLabel') }}</label>
          <input id="compose-category" v-model="category" type="text" maxlength="32" list="category-options" :placeholder="t('compose.categoryPlaceholder')" />
          <datalist id="category-options">
            <option v-for="c in categoryOptions" :key="c" :value="c" />
          </datalist>
        </div>
        <div class="compose-field">
          <label class="compose-label" for="compose-tags">{{ t('compose.tagsLabel') }}</label>
          <input id="compose-tags" v-model="tagsInput" type="text" :placeholder="t('compose.tagsPlaceholder')" />
        </div>
      </div>

      <div class="compose-field">
        <div class="compose-body-toolbar">
          <label class="compose-label" for="compose-body">{{ t('compose.bodyLabel') }}</label>
          <div class="compose-tools">
            <button type="button" class="compose-tool-btn" @click="pickImage">{{ t('compose.insertImage') }}</button>
            <button type="button" class="compose-preview-toggle" :class="{ active: showPreview }" @click="showPreview = !showPreview">
              {{ showPreview ? t('compose.edit') : t('compose.preview') }}
            </button>
          </div>
        </div>

        <!-- 插图上传面板：选图即上传（进度条），说明 = Markdown alt，插入后渲染为图下说明 -->
        <div v-if="imageDraft" class="compose-image-panel">
          <div class="compose-image-meta">
            <span class="compose-image-name">{{ imageDraft.file.name }}</span>
            <span v-if="imageDraft.uploading" class="compose-image-status">{{ t('compose.imageUploading', { pct: imageDraft.pct }) }}</span>
            <span v-else-if="imageDraft.name" class="compose-image-status ok">{{ t('compose.imageUploaded') }}</span>
          </div>
          <!-- 服务端压缩结果：文章默认读压缩版，读者可查看原图 -->
          <p
            v-if="imageDraft.name && imageDraft.size && imageDraft.displaySize && imageDraft.displaySize < imageDraft.size"
            class="compose-image-compress"
          >
            {{ t('compose.imageCompressed', { from: formatBytes(imageDraft.size), to: formatBytes(imageDraft.displaySize) }) }}
          </p>
          <div class="compose-image-progress" aria-hidden="true">
            <div class="compose-image-progress-bar" :style="{ width: (imageDraft.name ? 100 : imageDraft.pct) + '%' }"></div>
          </div>
          <input
            v-model="imageDraft.caption"
            type="text"
            class="compose-image-caption"
            maxlength="120"
            :placeholder="t('compose.imageCaptionPlaceholder')"
            :aria-label="t('compose.imageCaptionLabel')"
          />
          <p v-if="imageDraft.error" class="compose-error">{{ imageDraft.error }}</p>
          <div class="compose-image-actions">
            <button type="button" class="compose-btn-ghost" @click="cancelImage">{{ t('compose.imageCancel') }}</button>
            <button type="button" class="compose-btn-submit" :disabled="!imageDraft.name" @click="insertImage">
              {{ t('compose.imageInsert') }}
            </button>
          </div>
        </div>

        <textarea
          v-show="!showPreview"
          id="compose-body"
          ref="bodyTextarea"
          v-model="body"
          rows="18"
          :placeholder="t('compose.bodyPlaceholder')"
          required
        ></textarea>
        <!-- 稿面计数：与服务端派生逻辑同源（中文 400 字/分 + 英文 200 词/分） -->
        <p v-show="!showPreview" class="compose-stats">{{ bodyStats }}</p>
        <div v-if="showPreview" class="compose-preview">
          <p class="compose-preview-eyebrow">{{ t('compose.previewEyebrow') }}</p>
          <div class="markdown-body" v-html="previewHtml"></div>
        </div>
      </div>

      <p v-if="error" class="compose-error">{{ error }}</p>
      <p v-if="notice" class="compose-notice">{{ notice }}</p>

      <div class="compose-actions">
        <button type="button" class="compose-btn-ghost" :disabled="pending" @click="cancel">{{ t('compose.cancel') }}</button>
        <button type="button" class="compose-btn-ghost" :disabled="pending" @click="save(0)">{{ t('compose.saveDraft') }}</button>
        <button type="submit" class="compose-btn-submit" :disabled="pending">
          {{ pending ? t('compose.saving') : (editSlug ? t('compose.saveEdit') : t('compose.publish')) }}
        </button>
      </div>
      <p class="compose-hint">{{ t('compose.hint') }}</p>

      <!-- 隐藏文件选择器：插图上传（multipart）与 .md 导入（本地读取） -->
      <input ref="imageInput" type="file" hidden :accept="IMAGE_ACCEPT" @change="onImageChange" />
      <input ref="mdInput" type="file" hidden accept=".md,.markdown,text/markdown" @change="onMdChange" />
    </form>
  </div>
</template>
