import { ref } from 'vue'

/**
 * 全局加载过渡状态。
 * 复刻原项目的 loading 对象：遮罩默认覆盖（covered=true），
 * reveal() 触发 loading_out（向下滑出），cover() 重新覆盖。
 */
const covered = ref(true)

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

// 外链跳转：复刻 loading.in(url) —— 先覆盖，1 秒后跳转
export function goExternal(url: string) {
  covered.value = true
  setTimeout(() => {
    window.location.href = url
  }, 1000)
}
