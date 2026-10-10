import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// 设计系统基础（CSS 变量、重置样式、工具类）
import './styles/design-system.css'
// 全局基础样式（页面无关，原样保留）
import './styles/loading_animation.css'
import './styles/global.css' // 替换 defalut.css
import './styles/ash_animation.css'
// 各页面样式（统一以页面包裹类前缀隔离，避免全局冲突）
import './styles/home.css' // 替换 index.css
import './styles/contact.css' // 新增联系方式样式
import './styles/chat.css' // 替换 online_chat.css
import './styles/question_bank.css'
import './styles/dev_log.css'
import './styles/blog.css'
import './styles/blog_detail.css' // 博客阅读页样式
import './styles/login.css'
import './styles/title_card.css' // 标题卡入口页样式
import './styles/charts_lab.css' // 图表实验室测试页样式
import './styles/share.css' // 二维码分享页样式
import './styles/admin.css' // 管理面板样式（独立设计体系）

createApp(App).use(router).mount('#app')
