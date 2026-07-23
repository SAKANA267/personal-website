import { createRouter, createWebHistory } from 'vue-router'
import { useLoading } from '../stores/loading'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../views/HomeView.vue') },
    { path: '/online-chat', component: () => import('../views/OnlineChatView.vue') },
    { path: '/question-bank', component: () => import('../views/QuestionBankView.vue') },
    { path: '/dev-log', component: () => import('../views/DevLogView.vue') },
    { path: '/login', component: () => import('../views/LoginView.vue') },
    { path: '/signup', component: () => import('../views/SignUpView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

const loading = useLoading()

// 复刻 loading.in(page)：每次跳转先覆盖遮罩，停留 1 秒后再切换（afterEach 揭示）
let firstNavigation = true
router.beforeEach((to, from) => {
  // 初次加载（整页刷新）：不额外等待，由 App.vue 挂载后揭示，贴合原 window.load 行为
  if (firstNavigation) {
    firstNavigation = false
    return true
  }
  if (to.path === from.path) return true
  loading.cover()
  return new Promise<void>((resolve) => setTimeout(resolve, 1000))
})

router.afterEach(() => {
  loading.reveal()
})

export default router
