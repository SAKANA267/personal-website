import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { useLoading, LOADING_COVER_MS } from '../stores/loading'
import { useAuth } from '../stores/auth'

const router = createRouter({
  // base 跟随 vite 的 base（生产 /web/），保证子路径下刷新不 404
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('../views/HomeView.vue') },
    { path: '/online-chat', component: () => import('../views/OnlineChatView.vue') },
    { path: '/question-bank', component: () => import('../views/QuestionBankView.vue') },
    { path: '/dev-log', component: () => import('../views/DevLogView.vue') },
    { path: '/blog', component: () => import('../views/BlogView.vue') },
    { path: '/blog/:slug', component: () => import('../views/BlogDetailView.vue') },
    // 博客撰写页（登录联动）：静态段优先级高于 /blog/:slug 参数段
    { path: '/blog/compose', component: () => import('../views/ComposeView.vue') },
    { path: '/login', component: () => import('../views/LoginView.vue') },
    { path: '/signup', component: () => import('../views/SignUpView.vue') },
    // 个人主页：/u/:username 公开主页；/u/me = 当前登录用户（未登录显示登录引导）。
    // 旧账号中心 /account 重定向至此——改密/退出/管理员工具并入主页「设置」标签
    {
      path: '/u/:username',
      component: () => import('../views/ProfileView.vue'),
    },
    { path: '/account', redirect: () => '/u/me' },
    // 二维码分享：/share 上传，/share/:code 扫码取件（同一视图按参数切换模式）
    { path: '/share', component: () => import('../views/ShareView.vue') },
    { path: '/share/:code', component: () => import('../views/ShareView.vue') },
    // 图表实验室：lieflat-charts skill 学习测试页（不在主导航，直接 URL 访问）
    { path: '/charts-lab', component: () => import('../views/ChartsLabView.vue') },
    // 管理面板：admin 白名单专用工作台（守卫在下方法等待登录对账后校验）
    { path: '/admin', component: () => import('../views/AdminView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

const loading = useLoading()

// 标题卡已并入首页顶部（HomeView 内），不再是独立路由；
// sessionStorage['titleCardSeen'] 的「每会话首次」语义由 HomeView 自行维护。

// 复刻 loading.in(page)：每次跳转先覆盖遮罩，停留 LOADING_COVER_MS 后再切换（afterEach 揭示）
let firstNavigation = true
router.beforeEach((to, from) => {
  // 初次加载（整页刷新）：不额外等待，由 App.vue 挂载后揭示，贴合原 window.load 行为
  if (firstNavigation) {
    firstNavigation = false
    return true
  }
  if (to.path === from.path) return true
  loading.cover()
  return new Promise<void>((resolve) => setTimeout(resolve, LOADING_COVER_MS))
})

router.afterEach(() => {
  loading.reveal()
})

// 登录态路由守卫：已登录访问登录/注册页 → 回首页；未登录访问撰写页 → 回登录页。
// （/u/me 由 ProfileView 自行渲染登录引导态，无需守卫拦截）
// username 由 localStorage 即时水合，守卫在 initAuth 对账前也能工作（后续响应式纠正）。
router.beforeEach((to) => {
  const { username } = useAuth()
  if ((to.path === '/login' || to.path === '/signup') && username.value) return '/'
  if (to.path === '/blog/compose' && !username.value) return '/login'
})

// 管理面板守卫：isAdmin 不落 localStorage（每次启动须等 /api/auth/me 对账），
// 刷新直入 /admin 时先等对账完成再判定——未登录去登录页，非管理员回首页。
router.beforeEach(async (to) => {
  if (to.path !== '/admin') return
  const { username, isAdmin, restored } = useAuth()
  if (!restored.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(restored, (v) => {
        if (v) {
          stop()
          resolve()
        }
      })
    })
  }
  if (!username.value) return '/login'
  if (!isAdmin.value) return '/'
})

export default router
