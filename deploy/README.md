# 部署 (deploy/)

本地一键脚本部署到 Linux 服务器，用 pm2 管理进程。**不走远程 CI**，全部在本地经 SSH 完成。

## 它做了什么

`npm run deploy`（= `bash deploy/deploy.sh`）：

1. 本地 `npm run build` 构建前端到 `client/dist`；
2. `tar` 打包 `client/dist` + `server` 源码（不含 `node_modules` / `.env` / 证书），经 SSH 管道直接在服务器 `<DEPLOY_DIR>` 解压；
3. 服务器上 `npm install --omit=dev` 装依赖，`pm2 reload`（首次 `pm2 start`）重启应用，`pm2 save` 持久化。

传输用 Git Bash 自带的 `tar` / `ssh`，Windows 无需额外安装 rsync。

## 前置：一次性服务器初始化

1. **运行时**：Node.js ≥ 18（建议 nvm，或宝塔自带）；`npm install -g pm2`。
2. **MySQL**：建库后导入 `server/src/schema.sql`（6 张表：messages / devLog / users / logs / blog_posts / share_items）。
3. **放置配置**（不进 git、不被部署覆盖）到服务器 `<DEPLOY_DIR>/server/`：
   - `.env`：参考 `server/.env.example`，填 DB 凭据、`SESSION_SECRET`、`PORT=3000`、`WS_PORT=9000`、生产 `WS_USE_SSL=true` 及证书路径；
   - 若 `WS_USE_SSL=true`，把证书放到 `server/certs/`（默认 `server.pem` / `server.key`）。
4. **反向代理 / SSL**（完整样例见 [`deploy/nginx.conf.example`](nginx.conf.example)，按域名/证书路径替换后 `nginx -t` 校验）：
   - `https://sakana267.online` → `127.0.0.1:3000`（Express，含静态前端，`/web/` 前缀在 nginx 剥除）；
   - `wss://sakana267.online:9000` → 直连 ws 的 9000 端口（或用 nginx 做 WebSocket 反代，样例文件文末有注释段）；
   - **必须传 `X-Forwarded-Proto` / `X-Forwarded-For`**：Express 侧 `trust proxy=1` 依赖它们识别 https（secure cookie）与真实 IP（限流），缺失会导致登录态异常、限流全按 127.0.0.1 计数；
   - **二维码分享需要**：在反代配置里放开上传体积（nginx 默认仅 1MB，超限直接 413）：
     ```nginx
     client_max_body_size 20m;   # 与 server/.env 的 SHARE_MAX_MB 保持一致
     ```
5. **pm2 开机自启**（首次部署成功后在服务器执行一次）：
   ```bash
   pm2 startup   # 按提示复制执行返回的命令
   pm2 save
   ```
6. **本地配置**：复制并填写部署目标信息
   ```bash
   cp deploy/.deploy.env.example deploy/.deploy.env
   ```
   至少填 `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_DIR`。确保本机已配置 SSH 公钥能免密 `ssh $DEPLOY_USER@$DEPLOY_HOST`。

## 目录结构（服务器）

部署后 `<DEPLOY_DIR>` 形如：

```
<DEPLOY_DIR>/
├─ server/
│  ├─ src/             ← 由部署覆盖
│  ├─ package.json     ← 由部署覆盖
│  ├─ tsconfig.json    ← 由部署覆盖
│  ├─ node_modules/    ← npm install 生成，增量保留
│  ├─ .env             ← 首次手动放置，不覆盖
│  ├─ certs/           ← 首次手动放置，不覆盖
│  └─ uploads/share/   ← 二维码分享的上传文件，运行时生成，部署不覆盖
├─ client/dist/        ← 由部署覆盖
├─ ecosystem.config.cjs
└─ remote-setup.sh
```

> `server/src/index.ts` 用 `path.resolve(__dirname, '../../client/dist')` 定位前端产物，所以 `server/` 与 `client/dist/` 必须同级——这也是部署根目录这样组织的原因，请勿改动该相对路径。

## 日常部署

```bash
npm run deploy
```

每次只覆盖源码与产物，依赖增量安装，pm2 平滑 reload。查看日志：

```bash
ssh <user>@<host> "pm2 logs personal-website --lines 50"
```

## 常见问题

- **`pm2: command not found`（或 node/npm）**：非交互 ssh 不加载你的 shell 配置。在 `deploy/.deploy.env` 里用绝对路径设置 `NODE_BIN` / `NPM_BIN` / `PM2_BIN`（服务器上 `which pm2` 查）。脚本已对 nvm 与宝塔路径做了兜底。
- **应用启动后连不上数据库**：检查 `server/.env` 是否存在且凭据正确（脚本会提醒 `.env` 缺失）。
- **前端能打开但聊天连不上**：确认 `client/.env.production` 的 `VITE_WS_URL`、服务器 9000 端口防火墙、SSL 证书与 `WS_USE_SSL` 设置一致。
- **部署因类型检查失败而中断**：`npm run build` 含 `vue-tsc --noEmit`，类型错误会阻止部署——这是有意为之，确保线上构建可用。

## 数据备份（backup.sh）

`deploy/backup.sh` 对 MySQL 与上传文件做全量备份（自动读取 `server/.env` 的连接配置，密码经 `MYSQL_PWD` 环境变量传递，不落在命令行）：

1. `mysqldump --single-transaction --quick`（不锁表）→ gzip 到 `backups/db_<库>_<时间戳>.sql.gz`；
2. `tar` 打包 `server/uploads/`（二维码分享的上传文件）；
3. 删除超过 `RETENTION_DAYS`（默认 14）天的旧备份文件；
4. 清理 `logs` 表超过 `LOGS_RETENTION_DAYS`（默认 90）天的聊天日志——该表每条聊天消息/上下线都写一行，只增不减，是最主要的无界增长表。

本地与服务器均可运行；`DRY_RUN=1` 只打印将执行的命令不落盘：

```bash
bash deploy/backup.sh                              # 正常备份
DRY_RUN=1 bash deploy/backup.sh                    # 演练
MYSQLDUMP_BIN=/usr/bin/mysqldump bash deploy/backup.sh   # mysqldump 不在 PATH 时
LOGS_RETENTION_DAYS=0 bash deploy/backup.sh        # 本次跳过 logs 清理
```

服务器建议 crontab 每日执行（产物留在本机 `backups/`，请另行 rsync/同步到异机或对象存储，避免与站点同盘共生死）：

```cron
0 4 * * * cd /path/to/deploy_dir && bash deploy/backup.sh >> backups/backup.log 2>&1
```

恢复方法：

```bash
gunzip < backups/db_xxx.sql.gz | mysql -u<user> -p personal_website   # 数据库
tar -xzf backups/uploads_xxx.tar.gz -C server/                        # 上传文件
```

## 可选：提交/推送即自动部署

如果之后想让「每次提交」自动触发部署，加一个 git 钩子调用本脚本即可，例如 `.git/hooks/post-commit`：

```bash
#!/usr/bin/env bash
bash deploy/deploy.sh
```

默认不启用——commit 往往频繁且包含未完成的工作。更推荐 `pre-push`（仅在 push 时触发）。需要时手动创建该钩子文件即可，不必入仓。
