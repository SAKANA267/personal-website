<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useLocale } from '../stores/locale'

const { t } = useLocale()

/**
 * 标题卡英雄区（首页顶部封面）。
 *
 * 行为：
 * - 会话首次进入站点时，作为首页第一屏铺满视口展示（标题卡），用户滚动 / 点击 / 按键 / 上滑即「收起」进入主页内容。
 * - 非首次进入（sessionStorage 已标记 titleCardSeen）则直接显示主页内容，标题卡不渲染。
 *
 * 入场编排（.is-entering 驱动，见 title_card.css）：
 *   构建线扫描 → 三色彩带错位落下 → 主标题滑入收拢 → 副标题 / 提示淡入
 * 收起动画（.is-leaving 驱动）：整卡向上滑出 + 背景暗角淡去，配合主页内容从下方升起。
 */

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const emit = defineEmits<{
  (e: 'enter'): void
}>()

// 元素引用：视差与故障效果
const cardRef = ref<HTMLElement | null>(null)
const ribbonsRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const titleWrapperRef = ref<HTMLElement | null>(null)

// 阶段：'entering'（入场编排中）→ 'idle'（静止展示）→ 'leaving'（收起中）
const phase = ref<'entering' | 'idle' | 'leaving'>('entering')

// 防重入：避免多次触发收起
const entered = ref(false)

function enter() {
  if (entered.value) return
  entered.value = true
  phase.value = 'leaving'
  // 等收起动画走完再通知父级揭示主页内容
  window.setTimeout(() => emit('enter'), LEAVE_MS)
}

// 鼠标视差：彩带与内容做轻微反向位移
function onMouseMove(e: MouseEvent) {
  if (phase.value !== 'idle') return
  const card = cardRef.value
  const ribbons = ribbonsRef.value
  const content = contentRef.value
  if (!card || !ribbons || !content) return
  const rect = card.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width - 0.5 // -0.5 ~ 0.5
  const y = (e.clientY - rect.top) / rect.height - 0.5
  ribbons.style.transform = `translateX(calc(-50% + ${x * 8}px)) translateY(${y * 4}px)`
  content.style.transform = `translate(calc(-50% + ${x * -3}px), calc(-50% + ${y * -2}px))`
}

function onMouseLeave() {
  if (ribbonsRef.value) ribbonsRef.value.style.transform = 'translateX(-50%)'
  if (contentRef.value) contentRef.value.style.transform = 'translate(-50%, -50%)'
}

// 滚轮：向下进入
function onWheel(e: WheelEvent) {
  if (e.deltaY > 0) enter()
}

// 键盘：↓ / PageDown / Space / Enter 进入
function onKeydown(e: KeyboardEvent) {
  if (['ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
    e.preventDefault()
    enter()
  }
}

// 触屏上滑进入
let touchStartY = 0
function onTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY ?? 0
}
function onTouchEnd(e: TouchEvent) {
  const endY = e.changedTouches[0]?.clientY ?? 0
  if (touchStartY - endY > 30) enter() // 手指上移 → 进入
}

// 随机故障跳动
let glitchTimer: ReturnType<typeof setInterval> | null = null

// 收起动画时长（ms），需与 CSS .title-card.is-leaving 的 transition 对齐
const LEAVE_MS = 850

onMounted(() => {
  if (!props.active) return
  // 入场编排由 CSS 默认 animation（forwards）在挂载时自动播放；
  // phase 初始为 'entering'，约 1.7s 后切到 'idle' 以启用视差。
  window.setTimeout(() => {
    if (phase.value === 'entering') phase.value = 'idle'
  }, 1700)

  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })

  glitchTimer = setInterval(() => {
    const tw = titleWrapperRef.value
    if (!tw) return
    if (Math.random() < 0.12) {
      tw.style.filter = 'hue-rotate(15deg) contrast(1.1)'
      setTimeout(() => {
        tw.style.filter = ''
      }, 80 + Math.random() * 60)
    }
  }, 2000)
})

onUnmounted(() => {
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
  if (glitchTimer) clearInterval(glitchTimer)
})

// 暴露给模板：用 entering 标记驱动入场动画播放
defineExpose({ phase })
</script>

<template>
  <section
    v-if="active"
    class="page-title-card"
    :class="[`is-${phase}`]"
    :aria-label="t('titleCard.aria')"
    @click="enter"
  >
    <div
      ref="cardRef"
      class="title-card"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    >
      <!-- 构成主义引导线 -->
      <div class="construct-line construct-line--h"></div>
      <div class="construct-line construct-line--v"></div>

      <!-- 左侧扫描线 -->
      <div class="scanlines"></div>

      <!-- 三色彩带（与全站加载遮罩四色中的前三色一致） -->
      <div ref="ribbonsRef" class="ribbons">
        <div class="ribbon ribbon--teal"></div>
        <div class="ribbon ribbon--rust"></div>
        <div class="ribbon ribbon--gold"></div>
      </div>

      <!-- 右上角占位 -->
      <div class="top-right">
        <div class="placeholder">○</div>
        <div class="placeholder">▷</div>
      </div>

      <!-- 主内容 -->
      <div ref="contentRef" class="content">
        <div class="subtitle">{{ t('titleCard.subtitle') }}</div>
        <div ref="titleWrapperRef" class="title-wrapper" data-text="SAKANA">
          <h1 class="title">SAKANA</h1>
        </div>
        <div class="dot"></div>
        <div class="enter-hint">{{ t('titleCard.hint') }}</div>
      </div>

      <!-- 角标 -->
      <div class="corner-mark corner-mark--bl">SAKANA-DEV / 01</div>
      <div class="corner-mark">SAKANA // SYS.OK</div>

      <!-- 胶片颗粒 -->
      <div class="grain"></div>
    </div>
  </section>
</template>
