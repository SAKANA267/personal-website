import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
// ALTCHA 官方 Web Component：import 即注册 <altcha-widget>（SHA/PBKDF2 worker 内置）。
// 语言包按站点所需注册 zh-cn / en；与组件一起落在被登录/注册页共享的分包里，不进主包。
// 组件样式在 shadow DOM 内自成体系（closed），外观经 --altcha-* CSS 变量贴合站点纸墨风
// （见 login.css 的 auth-captcha 小节，登录/注册页共用 .page-auth 前缀样式）。
import 'altcha'
import 'altcha/i18n/zh-cn'
import 'altcha/i18n/en'
import { api } from './useApi'
import { useLocale } from '../stores/locale'

/** widget 宿主元素上暴露的方法（reset 会在取新挑战的同时回到未验证态） */
export type AltchaWidget = HTMLElement & {
  reset?: (newState?: string, err?: string | null) => void
  getState?: () => string
}

/**
 * 登录/注册页共用的 ALTCHA 人机验证逻辑。
 *
 * widget 以 statechange 事件外抛 { state, payload }：verified 态的 payload 即
 * base64 解（服务端一次性核销）。自定元素事件不经 Vue 模板体系，这里挂原生监听。
 * 用法：const { altchaEl, altchaPayload, challengeUrl, altchaLang, resetAltcha } = useAltcha()
 * 模板里 <altcha-widget ref="altchaEl" :challenge="challengeUrl" :language="altchaLang" name="altcha" />
 */
export function useAltcha() {
  const { locale } = useLocale()
  const altchaEl = ref<AltchaWidget | null>(null)
  const altchaPayload = ref('')
  // 挑战题面地址走统一的 VITE_API_BASE，dev/prod（/web/ 前缀）自动正确
  const challengeUrl = api.altchaChallengeUrl()
  // 站点语言 zh/en → widget 语言（i18n 包注册键为 zh-cn / en）
  const altchaLang = computed(() => (locale.value === 'en' ? 'en' : 'zh-cn'))

  function onAltchaState(e: Event) {
    const detail = (e as CustomEvent<{ state?: string; payload?: string }>).detail
    if (detail?.state === 'verified' && detail.payload) {
      altchaPayload.value = detail.payload
    } else {
      altchaPayload.value = ''
    }
  }

  /** 解是一次性的：提交失败（口令错/用户名已存在/过期）后重置 widget，下轮提交重解 */
  function resetAltcha() {
    altchaPayload.value = ''
    altchaEl.value?.reset?.()
  }

  onMounted(() => altchaEl.value?.addEventListener('statechange', onAltchaState))
  onBeforeUnmount(() => altchaEl.value?.removeEventListener('statechange', onAltchaState))

  return { altchaEl, altchaPayload, challengeUrl, altchaLang, resetAltcha }
}
