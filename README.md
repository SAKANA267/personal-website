# personal_website（Vue 全栈重写版）

这是对原项目 `nihonggo_web_learning`（开发者 SAKANA 的个人网站）的**忠实移植**：在不修改信息与功能的前提下，把技术栈从「原生 HTML/CSS/JS + PHP/MySQL + Node WebSocket」重写为「Vue 3 + TypeScript SPA + Node/Express + MySQL + ws」。所有文案、视觉、动画与交互行为均原样保留。

>该站点是 SAKANA 的个人网站（首页 / 在线聊天 / 自定义题库 / 开发日志 / 博客 / 二维码分享 / 登录注册）

## 目录结构

```
personal_website/
├─ package.json          # workspaces 根，concurrently 同时启动前后端
├─ client/               # Vue 3 + TS + Vite + Vue Router（SPA）
├─ server/               # Node + Express + mysql2 + ws（TypeScript，tsx 运行）
└─ deploy/               # 部署脚本 + PM2 配置 + nginx 样例（详见 deploy/README.md）
```

## 准备

1. 安装依赖（根目录会同时安装两个 workspace）：
   ```bash
   npm install
   ```
2. 创建数据库并导入表结构（依据 `server/src/schema.sql`）。
3. 配置环境变量：
   - 复制 `server/.env.example` → `server/.env`，填入数据库连接、端口、SESSION_SECRET（生产缺失将拒绝启动）、ADMIN_USERNAMES（管理员白名单）、SHARE_MAX_MB（分享上传上限）、BLOG_IMAGE_MAX_MB（博客插图上限，默认 8）。
   - 复制 `client/.env.example` → `client/.env`（dev 默认即可）。

## 开发

```bash
npm run dev
```

- 前端：http://localhost:5173/web/ （Vite，`base: '/web/'`，`/api` 代理到后端 3000）
- 后端：http://localhost:3000 （Express）
- 聊天 WebSocket：ws://localhost:9000

## 生产构建

```bash
npm run build        # 产出 client/dist
npm start            # 启动 server
```

生产环境将 `client/.env.production` 的 `VITE_WS_URL` 指向 `wss://...`，并在 `server/.env` 中开启 `WS_USE_SSL=true` 并提供证书路径。站点挂在 nginx 子路径 `/web/` 下（nginx 剥除前缀后反代 Node，完整样例见 `deploy/nginx.conf.example`）。

## 博客撰写

登录后 `/blog/compose`（写文章）支持两项工具增强：

- **插入图片**：上传 PNG / JPG / GIF / WebP / BMP / AVIF（单张 ≤ 8MB，`BLOG_IMAGE_MAX_MB` 可调），上传面板可填写「图片说明」；插入后在正文中生成 `![说明](图片地址)`，文章里渲染为图片 + 图片下方居中说明。上传时服务端自动生成 **WebP 压缩展示版**（宽 ≤1600、质量 82，动图保留动画；小图不压缩），文章默认读压缩版，图片下方徽标标注当前读取的大小并提供「查看原图（原图大小）」链接（新标签页打开原图），原图永久保留。安全侧做 mime 白名单 + 扩展名一致性 + 魔数嗅探三重校验（伪装成图片的 HTML/脚本一律拒绝），SVG 因可携带脚本始终拒绝，并按用户限流与限额。
- **导入 .md 文件**：不想用网页编辑器的作者可在本地写好 `.md`（支持 frontmatter 的 title / category / tags）后一键导入，自动填充表单；文件只在浏览器本地读取，不经服务器。

取消上传/改稿残留的未引用图片由管理面板「博客文章 → 清理未引用图片」一键回收。

## 管理面板

`/admin` 是管理员（`server/.env` 的 `ADMIN_USERNAMES` 白名单）专用工作台，**独立于站点美术风格**（墨纸 + 朱砂印红的工具面板，样式隔离在 `client/src/styles/admin.css` 的 `.admin-app` 前缀下）。功能：站点概览（9 表计数 + 最近留言/聊天动态 + 服务器信息）、留言板审核（隐藏/恢复）、博客管理（上下线/编辑/删除/清理未引用图片）、评论删除、分享管理（删除/清理过期）、用户管理（贡献计数 + 重置密码）、聊天日志与开发日志（可追加）。所有数据服务端分页（`?page&pageSize&q`），接口统一走 `/api/admin/*`（`server/src/routes/admin.ts`，全部过管理员门禁）；账号菜单对管理员显示「管理面板」入口。


## 与原项目的差异说明

为交付**预期可用功能**与必要的安全/稳健性，做了以下处理（不改变正常可观察行为）：

- **登录修复**：原 `login.php` 用明文比对 bcrypt 哈希，登录永远失败且成功后跳转不存在的 `welcome.php`。本版用 `bcrypt.compare` 正确校验，成功后跳转首页。
- **参数化查询**：用 mysql2 预编译语句替代原 `real_escape_string` 字符串拼接，防注入，数据一致。
- **`messages.is_displayed` 默认 1**：原插入留言不写该列，依赖列默认值才能显示。
- **配置外置**：数据库凭据、端口、WS 地址全部走 `.env`，不再硬编码。

其余所有交互细节（加载 600ms 四色块过渡、灰烬粒子、复制 tooltip、聊天 Blob 解析与 `': '` 切分、题库红绿反馈与 localStorage、留言/日志交错淡入、页脚与彩虹签名）均严格保留。

