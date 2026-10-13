#!/usr/bin/env bash
# 数据备份脚本：在服务器（或本地）对 MySQL 与上传文件做全量备份。
#
# 用法（项目根目录或 deploy/ 下均可）：
#   bash deploy/backup.sh                 # 正常备份
#   DRY_RUN=1 bash deploy/backup.sh       # 只打印将执行的命令，不落盘
#   LOGS_RETENTION_DAYS=0 bash ...        # 临时覆盖保留期（0=不清 logs）
#
# 做四件事：
#   1. mysqldump 全库（--single-transaction 不锁表）→ gzip 落盘
#   2. tar 打包 server/uploads/（二维码分享与博客插图的上传文件）
#   3. 删除超过 RETENTION_DAYS 天的旧备份文件
#   4. 清理 logs 表超过 LOGS_RETENTION_DAYS 天的聊天日志（该表只增不减）
#
# 可用环境变量覆盖（一般不需要）：
#   BACKUP_DIR=...            备份输出目录（默认 <项目根>/backups，已在 .gitignore）
#   RETENTION_DAYS=14         备份文件保留天数
#   LOGS_RETENTION_DAYS=90    聊天日志保留天数（0 表示跳过清理）
#   MYSQLDUMP_BIN / MYSQL_BIN mysqldump / mysql 可执行文件（不在 PATH 时给绝对路径）
#
# 建议服务器 crontab（每天 4:00 备份）：
#   0 4 * * * cd /path/to/deploy_dir && bash deploy/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "错误：找不到 $ENV_FILE（数据库连接信息从这里读取）" >&2
  exit 1
fi

# 读取 server/.env 的 DB_* 配置（值不含引号，由 .env.example 约定）
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | tr -d '\r'
}
DB_HOST="$(env_value DB_HOST)";  DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(env_value DB_PORT)";  DB_PORT="${DB_PORT:-3306}"
DB_USER="$(env_value DB_USER)";  DB_USER="${DB_USER:-root}"
DB_PASSWORD="$(env_value DB_PASSWORD)"
DB_NAME="$(env_value DB_NAME)";  DB_NAME="${DB_NAME:-personal_website}"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
LOGS_RETENTION_DAYS="${LOGS_RETENTION_DAYS:-90}"
DRY_RUN="${DRY_RUN:-0}"

MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"

STAMP="$(date +%Y%m%d_%H%M%S)"
DB_OUT="$BACKUP_DIR/db_${DB_NAME}_${STAMP}.sql.gz"
UPLOADS_OUT="$BACKUP_DIR/uploads_${STAMP}.tar.gz"

# 密码经 MYSQL_PWD 环境变量传递，避免出现在命令行（ps 可见）
export MYSQL_PWD="$DB_PASSWORD"

echo "[backup] 目标库: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "[backup] 输出目录: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

# 1. 数据库（管道无法走通用 run()，分支书写）
echo "[backup] 1/4 mysqldump ..."
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] $MYSQLDUMP_BIN --host=$DB_HOST --port=$DB_PORT --user=$DB_USER --single-transaction --quick --no-tablespaces $DB_NAME | gzip > $DB_OUT"
else
  "$MYSQLDUMP_BIN" \
    --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    --single-transaction --quick --no-tablespaces \
    "$DB_NAME" | gzip > "$DB_OUT"
  echo "[backup]   → $DB_OUT ($(du -h "$DB_OUT" | cut -f1))"
fi

# 2. 上传文件（目录可能尚不存在，跳过即可）
echo "[backup] 2/4 uploads 打包 ..."
if [ ! -d "$PROJECT_ROOT/server/uploads" ]; then
  echo "[backup]   server/uploads 不存在，跳过"
elif [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] tar -czf $UPLOADS_OUT -C $PROJECT_ROOT/server uploads"
else
  tar -czf "$UPLOADS_OUT" -C "$PROJECT_ROOT/server" uploads
  echo "[backup]   → $UPLOADS_OUT ($(du -h "$UPLOADS_OUT" | cut -f1))"
fi

# 3. 过期备份清理
echo "[backup] 3/4 清理 ${RETENTION_DAYS} 天前的旧备份 ..."
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] find '$BACKUP_DIR' -name '*.gz' -mtime +$RETENTION_DAYS -delete"
else
  find "$BACKUP_DIR" -maxdepth 1 -name '*.gz' -mtime "+$RETENTION_DAYS" -delete
fi

# 4. logs 表保留期清理（聊天日志只增不减，是最大的无界增长表）
echo "[backup] 4/4 logs 表保留 ${LOGS_RETENTION_DAYS} 天 ..."
if [ "${LOGS_RETENTION_DAYS}" = "0" ]; then
  echo "[backup]   LOGS_RETENTION_DAYS=0，跳过"
elif [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] $MYSQL_BIN ... -e \"DELETE FROM logs WHERE timestamp < NOW() - INTERVAL $LOGS_RETENTION_DAYS DAY\""
else
  DELETED="$("$MYSQL_BIN" --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME" \
    -N -B -e "DELETE FROM logs WHERE timestamp < NOW() - INTERVAL $LOGS_RETENTION_DAYS DAY; SELECT ROW_COUNT();")"
  echo "[backup]   清理行数: $DELETED"
fi

unset MYSQL_PWD
echo "[backup] 完成。"
