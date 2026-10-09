import { ref, shallowRef } from 'vue'
import zh from '../locales/zh'

/**
 * 语言状态（plain reactive 模块，无 Pinia——项目约定，与 useAuth/useLoading 同风格）。
 *
 * - 默认中文打进主包（首屏直出、零闪烁）；其他语言按需动态 import 分包加载。
 * - t() 在模板/计算属性中调用时读取 pack（shallowRef）与 locale（ref），
 *   切语言或语言包到位即响应式重渲染，不走路由、不触发 loading 遮罩（600ms 封面机制不受影响）。
 * - key 未命中时逐级回落：当前语言包 → 中文包 → key 本身（方便发现漏译）。
 */

export type Locale = 'zh' | 'en'
export type MessagePack = typeof zh
/** 所有可用的文案 key（点分路径，由 zh 包推导；t() 调用点由 vue-tsc 校验）。 */
export type MessageKey = ExtractPaths<MessagePack>

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type ExtractPaths<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: ExtractPaths<T[K], Prefix extends '' ? K : Join<Prefix, K>>
    }[keyof T & string]
  : Prefix

const STORAGE_KEY = 'locale'

// 非默认语言的按需加载器（静态映射，便于 Vite 分包分析）
const loaders: Record<Exclude<Locale, 'zh'>, () => Promise<{ default: MessagePack }>> = {
  en: () => import('../locales/en'),
}

// 已加载语言包的缓存；当前生效包走 shallowRef 保证响应式
const packs: Partial<Record<Locale, MessagePack>> = { zh }

function resolveInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // 存储不可用（隐私模式等）时回落默认语言
  }
  return 'zh'
}

const locale = ref<Locale>(resolveInitial())
// 当前语言包：包整体替换时触发所有依赖 t() 的模板重渲染（shallowRef 足够，包内不改动）
const pack = shallowRef<MessagePack>(zh)

function htmlLangOf(l: Locale): string {
  return l === 'en' ? 'en' : 'zh-CN'
}

// 模块加载即同步一次 <html lang>（SSR 无顾虑：本项目是纯 CSR）
if (typeof document !== 'undefined') {
  document.documentElement.lang = htmlLangOf(locale.value)
}

function lookup(source: unknown, key: string): unknown {
  let node: unknown = source
  for (const seg of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[seg]
  }
  return node
}

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (raw, name) =>
    vars[name] !== undefined ? String(vars[name]) : raw
  )
}

/** 取文案；占位符 {name} 用 vars 替换。未命中回落中文包，仍无则返回 key 本身。 */
function t(key: MessageKey, vars?: Record<string, unknown>): string {
  const raw = lookup(pack.value, key) ?? lookup(zh, key)
  return typeof raw === 'string' ? interpolate(raw, vars) : key
}

/**
 * 切换语言：按需加载语言包后整体替换（纯响应式，无需刷新页面）。
 * 启动补载场景（locale 已是目标值但包刚到位）也走 pack.value 赋值触发重渲染。
 */
async function setLocale(next: Locale) {
  if (next !== 'zh' && !packs[next]) {
    try {
      packs[next] = (await loaders[next]()).default
    } catch {
      // 分包加载失败（极端网络场景）：保持现状
      return
    }
  }
  const loaded = packs[next]
  if (!loaded || pack.value === loaded) return
  pack.value = loaded
  if (locale.value === next) return
  locale.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存储不可用时仅本次会话生效
  }
  document.documentElement.lang = htmlLangOf(next)
}

// 冷启动：保存的语言若非默认中文，语言包还不在内存里——补载（到位前先按中文渲染，避免空白）
if (locale.value !== 'zh') void setLocale(locale.value)

/**
 * 服务端错误码 → 本地化文案。
 * 服务端约定返回 { error: 'CODE', ...params }；已知码查 api.* 词条（带参数插值），
 * 未知串（历史遗留/意外文本）原样展示，无 error 时用调用方给的兜底 key。
 */
function apiError(data: unknown, fallbackKey: MessageKey): string {
  if (data != null && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const code = obj.error
    if (typeof code === 'string' && code) {
      const key = `api.${code}` as MessageKey
      const msg = t(key, obj)
      if (msg !== key) return msg
      return code
    }
  }
  return t(fallbackKey)
}

export function useLocale() {
  return {
    locale,
    t,
    setLocale,
    apiError,
  }
}
