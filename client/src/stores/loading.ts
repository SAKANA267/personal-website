import { ref } from 'vue'

/**
 * 全局加载过渡状态。遮罩默认覆盖（covered=true），reveal() 揭示，cover() 重新覆盖。
 */
const covered = ref(true)

// 遮罩「覆盖」阶段时长（ms）：入场动画须在此时间内完成；路由守卫 / 首屏 / 外链共用
export const LOADING_COVER_MS = 600

export function useLoading() {
  return {
    covered,
    cover() {
      covered.value = true
    },
    reveal() {
      covered.value = false
    },
  }
}

// 外链跳转：先覆盖，遮罩时长后再跳转
export function goExternal(url: string) {
  covered.value = true
  setTimeout(() => {
    window.location.href = url
  }, LOADING_COVER_MS)
}
