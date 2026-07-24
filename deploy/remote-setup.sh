#!/usr/bin/env bash
# 服务器端部署脚本：安装 server 依赖 + 用 pm2 启动/重载应用 + pm2 save。
# 由 deploy/deploy.sh 通过 ssh 调用，工作目录为部署根目录 <DEPLOY_DIR>。
# 也可以登录服务器后手动执行：cd <DEPLOY_DIR> && bash remote-setup.sh
set -euo pipefail

APP_NAME="${1:-personal-website}"

# 这些变量允许被 deploy.sh 通过 ssh 命令前缀注入；缺省时用命令名。
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"
PM2_BIN="${PM2_BIN:-pm2}"

# --- 让非交互 ssh 也能找到 node/npm/pm2（兼容 nvm / 宝塔面板等）---
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 2>/dev/null || true
for _p in /www/server/nodejs/current/bin /www/server/nodejs/*/bin; do
  [ -d "$_p" ] && export PATH="$_p:$PATH"
done

echo "[remote] 工作目录: $(pwd)"
echo "[remote] node: $("$NODE_BIN" -v 2>/dev/null || echo '未找到')   pm2: $("$PM2_BIN" -v 2>/dev/null || echo '未找到')"

# --- 安装 server 生产依赖（tsx 已在 dependencies，--omit=dev 也会装上）---
echo "[remote] 安装 server 依赖 (--omit=dev)..."
(
  cd server
  "$NPM_BIN" install --omit=dev --no-audit --no-fund
)

# --- 校验 server/.env（不覆盖、不传输，必须首次手动放置）---
if [ ! -f server/.env ]; then
  echo "[remote] 警告: server/.env 不存在！应用大概率无法连接数据库或启动。" >&2
  echo "[remote]        请参考 server/.env.example 手动创建 server/.env 后重新部署。" >&2
fi

# --- 启动或重载 pm2（已存在则 reload，否则首次 start）---
echo "[remote] 同步 pm2 应用: $APP_NAME"
if "$PM2_BIN" describe "$APP_NAME" >/dev/null 2>&1; then
  "$PM2_BIN" reload ecosystem.config.cjs --update-env
else
  "$PM2_BIN" start ecosystem.config.cjs
fi

# 持久化进程列表（配合 `pm2 startup` 实现开机自启）
"$PM2_BIN" save

echo "[remote] 部署完成。当前 pm2 进程："
"$PM2_BIN" list
