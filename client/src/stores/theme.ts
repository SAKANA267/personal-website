import { ref } from 'vue'

/**
 * 白天/黑夜主题状态（plain reactive 模块，无 Pinia——项目约定，与 useLocale/useAuth 同风格）。
 *
 * - 全站颜色收敛在 design-system.css 的 --ink/--paper/灰阶变量上，
 *   本模块只负责给 <html> 挂/摘 `dark` 类，暗色色板由 `html.dark` 选择器覆盖；
 *   标题卡（自带深色封面）、/admin（自有 --ap-* 体系）不消费这些变量，天然不受影响。
 * - 取值优先级：localStorage 显式选择 > 系统偏好（prefers-color-scheme）。
 *   未做过显式选择时跟随系统实时变化；一旦手动切换即固化，不再跟随。
 * - index.html 里有一段同逻辑的内联脚本在首帧前挂类（防亮色闪烁），此处初始化幂等。
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'
/** 移动端浏览器 chrome（地址栏底色）跟随主题；与 design-system 色板保持一致 */
const THEME_COLOR: Record<Theme, string> = { light: '#fafafa', dark: '#121314' }
/** 切换时的全局色彩过渡窗口（ms）；html.theme-transition 的 CSS 见 design-system.css §1b */
const TRANSITION_MS = 250

function savedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 存储不可用（隐私模式等）：仅本次会话按系统偏好
  }
  return null
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

const isDark = ref<boolean>((savedTheme() ?? (systemPrefersDark() ? 'dark' : 'light')) === 'dark')

function applyToDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', isDark.value)
  // theme-color meta 由内联脚本预先创建；此处兜底创建并随切换更新
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = THEME_COLOR[isDark.value ? 'dark' : 'light']
}

// 切换瞬间的色彩过渡：临时挂类让全站 background/color/border 平滑渐变，
// 窗口结束后摘除，避免常驻 transition 拖慢其它交互（CSS 侧已按 reduced-motion 关闭）
let transitionTimer: ReturnType<typeof setTimeout> | undefined

function withTransition(fn: () => void) {
  if (typeof document === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) {
    fn()
    return
  }
  const root = document.documentElement
  root.classList.add('theme-transition')
  fn()
  clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), TRANSITION_MS)
}

/** 切换主题：立即生效并写入 localStorage（显式选择后不再跟随系统）。 */
function toggleTheme() {
  withTransition(() => {
    isDark.value = !isDark.value
    try {
      localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light')
    } catch {
      // 存储不可用时仅本次会话生效
    }
    applyToDocument()
  })
}

// 模块加载即同步一次 DOM（幂等：内联脚本可能已挂过同一个类）
applyToDocument()

// 无显式选择时跟随系统偏好实时变化；用户一旦手动切换（localStorage 有值）即固化
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (e: MediaQueryListEvent) => {
    if (savedTheme() !== null || e.matches === isDark.value) return
    withTransition(() => {
      isDark.value = e.matches
      applyToDocument()
    })
  }
  mq.addEventListener?.('change', onChange)
}

/** 当前主题名（'light' | 'dark'），供模板按当前态取图标/文案。 */
export function useTheme() {
  return { isDark, toggleTheme }
}
