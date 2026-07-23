# personal_website（Vue 全栈重写版）

这是对原项目 `nihonggo_web_learning`（开发者 SAKANA 的个人网站）的**忠实移植**：在不修改信息与功能的前提下，把技术栈从「原生 HTML/CSS/JS + PHP/MySQL + Node WebSocket」重写为「Vue 3 + TypeScript SPA + Node/Express + MySQL + ws」。所有文案、视觉、动画与交互行为均原样保留。

>该站点是 SAKANA 的个人网站（首页 / 在线聊天 / 自定义题库 / 开发日志 / 登录注册）

## 目录结构

```
personal_website/
├─ package.json          # workspaces 根，concurrently 同时启动前后端
├─ client/               # Vue 3 + TS + Vite + Vue Router（SPA）
└─ server/               # Node + Express + mysql2 + ws（TypeScript，tsx 运行）
```

## 准备

1. 安装依赖（根目录会同时安装两个 workspace）：
   ```bash
   npm install
   ```
2. 创建数据库并导入表结构（依据 `server/src/schema.sql`）。
3. 配置环境变量：
   - 复制 `server/.env.example` → `server/.env`，填入数据库连接、端口、SESSION_SECRET。
   - 复制 `client/.env.example` → `client/.env`（dev 默认即可）。

## 开发

```bash
npm run dev
```

- 前端：http://localhost:5173 （Vite，`/api` 代理到后端 3000）
- 后端：http://localhost:3000 （Express）
- 聊天 WebSocket：ws://localhost:9000

## 生产构建

```bash
npm run build        # 产出 client/dist
npm start            # 启动 server
```

生产环境将 `client/.env.production` 的 `VITE_WS_URL` 指向 `wss://...`，并在 `server/.env` 中开启 `WS_USE_SSL=true` 并提供证书路径。

## 与原项目的差异说明

为交付**预期可用功能**与必要的安全/稳健性，做了以下处理（不改变正常可观察行为）：

- **登录修复**：原 `login.php` 用明文比对 bcrypt 哈希，登录永远失败且成功后跳转不存在的 `welcome.php`。本版用 `bcrypt.compare` 正确校验，成功后跳转首页。
- **参数化查询**：用 mysql2 预编译语句替代原 `real_escape_string` 字符串拼接，防注入，数据一致。
- **`messages.is_displayed` 默认 1**：原插入留言不写该列，依赖列默认值才能显示。
- **配置外置**：数据库凭据、端口、WS 地址全部走 `.env`，不再硬编码。

其余所有交互细节（加载 1000ms 过渡、灰烬粒子、复制 tooltip、聊天 Blob 解析与 `': '` 切分、题库红绿反馈与 localStorage、留言/日志交错淡入、页脚与彩虹签名）均严格保留。

