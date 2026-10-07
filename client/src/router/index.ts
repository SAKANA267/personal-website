import { createRouter, createWebHistory } from 'vue-router'
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
    { path: '/login', component: () => import('../views/LoginView.vue') },
    { path: '/signup', component: () => import('../views/SignUpView.vue') },
    // 账号中心：改密/退出（登录适配新增，复用 .page-auth 认证页样式）
    { path: '/account', component: () => import('../views/AccountView.vue') },
    // 二维码分享：/share 上传，/share/:code 扫码取件（同一视图按参数切换模式）
    { path: '/share', component: () => import('../views/ShareView.vue') },
    { path: '/share/:code', component: () => import('../views/ShareView.vue') },
    // 图表实验室：lieflat-charts skill 学习测试页（不在主导航，直接 URL 访问）
    { path: '/charts-lab', component: () => import('../views/ChartsLabView.vue') },
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

// 登录态路由守卫：已登录访问登录/注册页 → 回首页；未登录访问账号页 → 回登录页。
// username 由 localStorage 即时水合，守卫在 initAuth 对账前也能工作（后续响应式纠正）。
router.beforeEach((to) => {
  const { username } = useAuth()
  if ((to.path === '/login' || to.path === '/signup') && username.value) return '/'
  if (to.path === '/account' && !username.value) return '/login'
})

export default router
