-- 博客文章种子数据（一次性灌入，内容与 client/src/data/blogPosts.ts 保持一致）
-- 用法：建库建表后执行  mysql <DB_NAME> < server/src/seed_blog.sql
-- tags 列用 JSON_ARRAY(...)，mysql2 读取时自动解析为 JS 数组。
-- 若已灌过且想重置：先 DELETE FROM blog_posts; 再执行本文件。

INSERT INTO blog_posts (title, excerpt, `date`, category, tags, read_time) VALUES
('重构留言板：从 PHP 到 Vue 3',
 '把老的 PHP + 原生 JS 留言板搬到 Vue 3 + TypeScript SPA。重点不在重写，而在不破坏任何肉眼可见的细节——提交提示、时间戳格式、卡片淡入顺序，一个都不能少。',
 '2026-07-20', '前端', JSON_ARRAY('vue', 'typescript', '重构'), 8),
('黑、白与克制：个人网站的配色笔记',
 '不用渐变、不用撞色，只用 #fafafa 的纸色、#0a0a0a 的墨色和六层灰度搭出层次。极简不是少做事，而是把每一格间距、每一道发丝线都调到刚好。',
 '2026-07-12', '设计', JSON_ARRAY('design', 'minimalism'), 5),
('WebSocket 聊天室：以 IP 为键的连接管理',
 'ws 服务独立于 Express，跑在自己的端口上。客户端按 IP 索引——同一 IP 的新连接会覆盖旧连接，广播时排除发送者自己，再把连接、断开、消息事件写进 logs 表。',
 '2026-07-02', '后端', JSON_ARRAY('node', 'websocket', 'ws'), 7),
('题库的红色与绿色：即时反馈怎么做',
 '选择题提交后立刻标红错误项、标绿正确项，并把作答记录写进 localStorage，刷新页面也不丢。一点小的状态管理，换来很实在的学习反馈。',
 '2026-06-21', '前端', JSON_ARRAY('vue', 'ux', 'localStorage'), 4),
('bcrypt.compare：修好那个登录漏洞',
 '老站登录用的是明文比对，等于把密码裸奔在数据库里。换成 bcrypt 哈希存储、bcrypt.compare 校验，注册时盐轮 10，重复用户名返回 400。一次迟到的安全课。',
 '2026-06-09', '后端', JSON_ARRAY('node', 'security', 'bcrypt'), 6),
('1000 毫秒的等待：复刻加载过渡',
 '原站每次跳转会先盖一层遮罩、停 1 秒再切换。这个节奏成了站点气质的一部分，于是在路由守卫里用 beforeEach + setTimeout(1000) 一比一还原，首屏和同路径跳转除外。',
 '2026-05-28', '随笔', JSON_ARRAY('animation', 'ux'), 3),
('灰烬粒子：用 Canvas 画一点氛围',
 '首页背景飘着细碎的灰烬，是整站唯一的“动”。用一张离屏 Canvas 按帧重绘，控制粒子的数量、速度和透明度，让它安静地落，不抢正文的注意力。',
 '2026-05-15', '前端', JSON_ARRAY('canvas', 'animation'), 5);
