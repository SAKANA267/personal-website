<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useLocale } from '../stores/locale'

/**
 * 轻量图片裁剪器（零依赖手写，遵循本站 i18n/主题 store 同款惯例）：
 * 固定比例视口 + 图片平移/缩放 = 用户自由选择裁剪区域（头像 1:1、壁纸 4:1）。
 * - 拖动平移：Pointer Events（鼠标/触屏统一），双指捏合缩放，滚轮缩放，+/- 按钮与重置兜底；
 * - 平移始终被夹在"图片铺满视口"的范围内（不会露出空白边）；
 * - crop() 把视口可见区域映射回自然像素，经 canvas 压平为 JPEG（透明 PNG 垫白底）输出 Blob。
 *   注意：GIF/WebP 动图经 canvas 取首帧（裁剪后为静帧）。
 */
const props = withDefaults(
  defineProps<{
    src: string
    ratio: number          // 裁剪宽高比（宽/高）：头像 1，壁纸 4
    viewportWidth?: number // 视口显示宽度（px）
    maxOutWidth?: number   // 输出图像宽度上限（px），且不超过源图分辨率（不放大）
  }>(),
  { viewportWidth: 300, maxOutWidth: 512 }
)

const emit = defineEmits<{ ready: [] }>()

const { t } = useLocale()
const imgEl = ref<HTMLImageElement | null>(null)
const loaded = ref(false)
const natural = reactive({ w: 0, h: 0 })

const vw = computed(() => props.viewportWidth)
const vh = computed(() => Math.round(props.viewportWidth / props.ratio))

// zoom=1 即 cover 基线（图片恰好铺满视口），缩放范围 1~4
const baseScale = computed(() => {
  if (!natural.w || !natural.h) return 1
  return Math.max(vw.value / natural.w, vh.value / natural.h)
})
const state = reactive({ zoom: 1, x: 0, y: 0 })
const scale = computed(() => baseScale.value * state.zoom)
const MIN_ZOOM = 1
const MAX_ZOOM = 4

// 图片显示尺寸必须 ≥ 视口（cover），平移量夹在溢出的一半以内
function clampPan() {
  const dw = natural.w * scale.value - vw.value
  const dh = natural.h * scale.value - vh.value
  state.x = dw > 0 ? Math.max(-dw / 2, Math.min(dw / 2, state.x)) : 0
  state.y = dh > 0 ? Math.max(-dh / 2, Math.min(dh / 2, state.y)) : 0
}

watch([() => state.zoom, vw, vh], clampPan)

function setZoom(next: number) {
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
}

function reset() {
  state.zoom = 1
  state.x = 0
  state.y = 0
}

function onImgLoad() {
  natural.w = imgEl.value?.naturalWidth ?? 0
  natural.h = imgEl.value?.naturalHeight ?? 0
  reset()
  loaded.value = true
  emit('ready')
}

const imgStyle = computed(() => ({
  transform: `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${scale.value})`,
}))

// ---------- 指针交互：单指拖动 / 双指捏合 ----------
const pointers = reactive(new Map<number, { x: number; y: number }>())
let pinchBase: { dist: number; zoom: number } | null = null
let dragBase: { px: number; py: number; x: number; y: number } | null = null

function dist2(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function onPointerDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) {
    dragBase = { px: e.clientX, py: e.clientY, x: state.x, y: state.y }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinchBase = { dist: dist2(a, b), zoom: state.zoom }
    dragBase = null
  }
}

function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1 && dragBase) {
    state.x = dragBase.x + (e.clientX - dragBase.px)
    state.y = dragBase.y + (e.clientY - dragBase.py)
    clampPan()
  } else if (pointers.size === 2 && pinchBase) {
    const [a, b] = [...pointers.values()]
    const d = dist2(a, b)
    if (d > 0 && pinchBase.dist > 0) setZoom((pinchBase.zoom * d) / pinchBase.dist)
  }
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchBase = null
  if (pointers.size === 1) {
    const [only] = [...pointers.values()]
    dragBase = { px: only.x, py: only.y, x: state.x, y: state.y }
  } else {
    dragBase = null
  }
}

function onWheel(e: WheelEvent) {
  // 滚轮向上放大、向下缩小（步进 1.15）
  setZoom(state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
}

// ---------- 裁剪输出 ----------
/** 视口当前可见区域 → canvas 重绘 → JPEG Blob（宽 ≤ maxOutWidth 且不放大源图） */
function crop(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = imgEl.value
    if (!img || !loaded.value || !natural.w) {
      reject(new Error('image not loaded'))
      return
    }
    const s = scale.value
    // 视口可见区域对应的自然像素：尺寸 = 视口/s，中心 = 图中心 - 平移/s
    const cw = vw.value / s
    const ch = vh.value / s
    const cx = natural.w / 2 - state.x / s
    const cy = natural.h / 2 - state.y / s
    const outW = Math.max(16, Math.min(props.maxOutWidth, Math.round(cw)))
    const outH = Math.max(16, Math.round(outW / props.ratio))
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('canvas unavailable'))
      return
    }
    // 透明 PNG 垫白底（统一输出 JPEG）
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, outW, outH)
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.92
    )
  })
}

defineExpose({ crop, loaded, reset })
</script>

<template>
  <div class="profile-cropper">
    <div
      class="profile-cropper-viewport"
      :style="{ width: vw + 'px', height: vh + 'px' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    >
      <img
        v-if="src"
        ref="imgEl"
        class="profile-cropper-img"
        :src="src"
        alt=""
        draggable="false"
        :style="imgStyle"
        @load="onImgLoad"
      />
    </div>
    <div class="profile-cropper-ops">
      <button type="button" class="profile-cropper-btn" :aria-label="t('profile.cropZoomOut')" :title="t('profile.cropZoomOut')" @click="setZoom(state.zoom / 1.25)">−</button>
      <button type="button" class="profile-cropper-btn" :aria-label="t('profile.cropZoomIn')" :title="t('profile.cropZoomIn')" @click="setZoom(state.zoom * 1.25)">＋</button>
      <button type="button" class="profile-cropper-reset" @click="reset">{{ t('profile.cropReset') }}</button>
    </div>
    <p class="profile-cropper-hint">{{ t('profile.cropHint') }}</p>
  </div>
</template>
