import { ref } from 'vue'

/**
 * 全局加载过渡状态。遮罩默认覆盖（covered=true），reveal() 揭示，cover() 重新覆盖。
 */
const covered = ref(true)

/**
 * 标题卡首屏豁免：true 时 LoadingOverlay 完全不渲染（首绘无色块、无动画 → 无闪烁）。
 * cover() 会清除此标志，使离开标题卡时的转场遮罩照常播放。
 */
const hidden = ref(false)

// 遮罩「覆盖」阶段时长（ms）：入场动画须在此时间内完成；路由守卫 / 首屏 / 外链共用
export const LOADING_COVER_MS = 600

// 会话首次进入站点 → 标题卡：首屏不播放四色块遮罩
// （此处在 store 被 import 时执行，早于 App 首绘，保证标题卡首帧即无遮罩闪烁）
if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('titleCardSeen')) {
  covered.value = false
  hidden.value = true
}

export function useLoading() {
  return {
    covered,
    hidden,
    cover() {
      hidden.value = false
      covered.value = true
    },
    reveal() {
      covered.value = false
    },
    hide() {
      hidden.value = true
    },
  }
}

// 外链跳转：先覆盖，遮罩时长后再跳转
export function goExternal(url: string) {
  hidden.value = false
  covered.value = true
  setTimeout(() => {
    window.location.href = url
  }, LOADING_COVER_MS)
}
