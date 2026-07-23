import { reactive } from 'vue'

/**
 * 点击复制 + "已复制" 提示，复刻原 index.js 的 copyText。
 * 提示定位到点击坐标，500ms 后淡出；复制优先用 Clipboard API，降级到 execCommand。
 */
export function useCopyText() {
  const tooltip = reactive({ show: false, x: 0, y: 0 })
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string, clientX: number, clientY: number) {
    tooltip.x = clientX
    tooltip.y = clientY
    tooltip.show = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      tooltip.show = false
    }, 500)

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return { tooltip, copy }
}
