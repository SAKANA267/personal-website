import type { BlogPost } from '../types'

/**
 * 博客文章静态数据（前端占位）。
 *
 * 目前只做前端展示，后续若接入后端：
 * 在 composables/useApi.ts 增加 getBlogPosts: () => getJson<BlogPost[]>('/blog')，
 * 新建 server 端 /api/blog 路由与数据表，再把这里的本地导入换成 api.getBlogPosts() 即可。
 *
 * 按日期倒序（最新在前）。
 */
export const blogPosts: BlogPost[] = [
  {
    id: 1,
    title: '重构留言板：从 PHP 到 Vue 3',
    excerpt:
      '把老的 PHP + 原生 JS 留言板搬到 Vue 3 + TypeScript SPA。重点不在重写，而在不破坏任何肉眼可见的细节——提交提示、时间戳格式、卡片淡入顺序，一个都不能少。',
    date: '2026-07-20',
    category: '前端',
    tags: ['vue', 'typescript', '重构'],
    readTime: 8,
  },
  {
    id: 2,
    title: '黑、白与克制：个人网站的配色笔记',
    excerpt:
      '不用渐变、不用撞色，只用 #fafafa 的纸色、#0a0a0a 的墨色和六层灰度搭出层次。极简不是少做事，而是把每一格间距、每一道发丝线都调到刚好。',
    date: '2026-07-12',
    category: '设计',
    tags: ['design', 'minimalism'],
    readTime: 5,
  },
  {
    id: 3,
    title: 'WebSocket 聊天室：以 IP 为键的连接管理',
    excerpt:
      'ws 服务独立于 Express，跑在自己的端口上。客户端按 IP 索引——同一 IP 的新连接会覆盖旧连接，广播时排除发送者自己，再把连接、断开、消息事件写进 logs 表。',
    date: '2026-07-02',
    category: '后端',
    tags: ['node', 'websocket', 'ws'],
    readTime: 7,
  },
  {
    id: 4,
    title: '题库的红色与绿色：即时反馈怎么做',
    excerpt:
      '选择题提交后立刻标红错误项、标绿正确项，并把作答记录写进 localStorage，刷新页面也不丢。一点小的状态管理，换来很实在的学习反馈。',
    date: '2026-06-21',
    category: '前端',
    tags: ['vue', 'ux', 'localStorage'],
    readTime: 4,
  },
  {
    id: 5,
    title: 'bcrypt.compare：修好那个登录漏洞',
    excerpt:
      '老站登录用的是明文比对，等于把密码裸奔在数据库里。换成 bcrypt 哈希存储、bcrypt.compare 校验，注册时盐轮 10，重复用户名返回 400。一次迟到的安全课。',
    date: '2026-06-09',
    category: '后端',
    tags: ['node', 'security', 'bcrypt'],
    readTime: 6,
  },
  {
    id: 6,
    title: '1000 毫秒的等待：复刻加载过渡',
    excerpt:
      '原站每次跳转会先盖一层遮罩、停 1 秒再切换。这个节奏成了站点气质的一部分，于是在路由守卫里用 beforeEach + setTimeout(1000) 一比一还原，首屏和同路径跳转除外。',
    date: '2026-05-28',
    category: '随笔',
    tags: ['animation', 'ux'],
    readTime: 3,
  },
  {
    id: 7,
    title: '灰烬粒子：用 Canvas 画一点氛围',
    excerpt:
      '首页背景飘着细碎的灰烬，是整站唯一的“动”。用一张离屏 Canvas 按帧重绘，控制粒子的数量、速度和透明度，让它安静地落，不抢正文的注意力。',
    date: '2026-05-15',
    category: '前端',
    tags: ['canvas', 'animation'],
    readTime: 5,
  },
]
