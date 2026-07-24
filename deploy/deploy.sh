#!/usr/bin/env bash
# 本地一键部署脚本：
#   构建前端 → 经 SSH 把产物和 server 源码传到服务器 → 远程装依赖并 pm2 重载。
#
# 用法（在项目根目录）：
#   npm run deploy            # 推荐
#   bash deploy/deploy.sh     # 等价
#
# 前置：复制 deploy/.deploy.env.example 为 deploy/.deploy.env 并填好服务器信息。
# 依赖：Git Bash 自带的 tar / ssh（Windows 下无需额外安装 rsync）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.deploy.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "错误：找不到 $ENV_FILE" >&2
  echo "请先执行：cp deploy/.deploy.env.example deploy/.deploy.env 并填写服务器信息。" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

# 容错：去掉 Windows 编辑器（CRLF）可能带入的 \r，否则主机/路径会带回车符导致 ssh 失败
DEPLOY_HOST="${DEPLOY_HOST:-}"; DEPLOY_HOST="${DEPLOY_HOST%$'\r'}"
DEPLOY_USER="${DEPLOY_USER:-}"; DEPLOY_USER="${DEPLOY_USER%$'\r'}"
DEPLOY_DIR="${DEPLOY_DIR:-}";   DEPLOY_DIR="${DEPLOY_DIR%$'\r'}"
PM2_APP="${PM2_APP:-}";         PM2_APP="${PM2_APP%$'\r'}"
SSH_PORT="${SSH_PORT:-}";       SSH_PORT="${SSH_PORT%$'\r'}"
NODE_BIN="${NODE_BIN:-}";       NODE_BIN="${NODE_BIN%$'\r'}"
NPM_BIN="${NPM_BIN:-}";         NPM_BIN="${NPM_BIN%$'\r'}"
PM2_BIN="${PM2_BIN:-}";         PM2_BIN="${PM2_BIN%$'\r'}"

: "${DEPLOY_HOST:?请在 .deploy.env 中设置 DEPLOY_HOST}"
: "${DEPLOY_USER:?请在 .deploy.env 中设置 DEPLOY_USER}"
: "${DEPLOY_DIR:?请在 .deploy.env 中设置 DEPLOY_DIR}"
PM2_APP="${PM2_APP:-personal-website}"
SSH_TARGET="$DEPLOY_USER@$DEPLOY_HOST"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "${SSH_PORT:-}" ]; then
  SSH_OPTS+=(-p "$SSH_PORT")
fi

cd "$PROJECT_ROOT"

echo "[1/3] 构建前端 (npm run build)..."
npm run build

echo "[2/3] 打包并通过 SSH 传输到 $SSH_TARGET:$DEPLOY_DIR ..."
# 用多个 -C 切换打包基目录，保证解压后目录结构为：
#   <DEPLOY_DIR>/client/dist
#   <DEPLOY_DIR>/server/{src,package.json,tsconfig.json}
#   <DEPLOY_DIR>/{ecosystem.config.cjs,remote-setup.sh}   ← 去掉 deploy/ 前缀
# 不传输：node_modules、server/.env、server/certs（敏感/体积大，首次手动放置）。
tar -czf - \
  -C "$PROJECT_ROOT" \
    client/dist \
    server/src \
    server/package.json \
    server/tsconfig.json \
  -C "$SCRIPT_DIR" \
    ecosystem.config.cjs \
    remote-setup.sh \
  | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p '$DEPLOY_DIR' && tar -xzf - -C '$DEPLOY_DIR'"

echo "[3/3] 远程安装依赖 + pm2 重载..."
# 通过命令前缀把 *_BIN / PM2_APP 注入到远程 shell 环境。
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  set -e
  cd '$DEPLOY_DIR'
  NODE_BIN='${NODE_BIN:-node}' NPM_BIN='${NPM_BIN:-npm}' PM2_BIN='${PM2_BIN:-pm2}' \\
  bash remote-setup.sh '${PM2_APP}'
"

echo
echo "✔ 部署完成。可访问站点验证，或 ssh $SSH_TARGET \"pm2 logs $PM2_APP --lines 50\" 查看日志。"
