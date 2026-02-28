#!/usr/bin/env bash
# ============================================================================
# 测试环境 Docker 生命周期管理脚本
#
# 用法:
#   ./test-env.sh up        # 构建并启动所有测试容器
#   ./test-env.sh down      # 停止并移除所有容器、网络
#   ./test-env.sh restart   # 重启所有服务
#   ./test-env.sh rebuild   # 强制重新构建镜像（--no-cache）并启动
#   ./test-env.sh rebuild <svc> # 重新构建并启动指定服务
#   ./test-env.sh build     # 仅构建所有镜像（不启动）
#   ./test-env.sh build <svc> # 仅构建指定服务镜像
#   ./test-env.sh status    # 查看服务状态
#   ./test-env.sh logs      # 查看所有服务日志（跟随模式）
#   ./test-env.sh logs <svc> # 查看单个服务日志（dispatcher/receiver-b/receiver-c/frontend）
#   ./test-env.sh health    # 健康检查所有后端服务
#   ./test-env.sh reset     # 重置配置到初始状态并重启
#   ./test-env.sh clean     # 完全清理：容器、镜像、日志、卷
#   ./test-env.sh send <json_file> # 向 dispatcher 发送测试回调（加密）
#   ./test-env.sh check     # 查看 receiver-b 和 receiver-c 收到的回调
#   ./test-env.sh clear     # 清空 receiver-b 和 receiver-c 的回调记录
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.test.yml"
PROJECT_NAME="tsign-test"

# 服务端口映射
DISPATCHER_PORT=5001
RECEIVER_B_PORT=5002
RECEIVER_C_PORT=5003
FRONTEND_PORT=5080

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${BLUE}[STEP]${NC}  $*"; }

# docker compose 命令兼容（v1: docker-compose / v2: docker compose）
compose_cmd() {
  if docker compose version &>/dev/null; then
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" "$@"
  fi
}

# ---- 子命令实现 ----

cmd_up() {
  log_info "启动测试环境..."
  log_step "确保配置目录和日志目录存在"
  ensure_dirs

  log_step "构建并启动容器"
  compose_cmd up -d --build

  log_step "等待服务就绪..."
  wait_for_healthy

  log_info "测试环境已就绪！"
  print_endpoints
}

cmd_down() {
  log_info "停止测试环境..."
  compose_cmd down --remove-orphans
  log_info "所有容器已停止并移除"
}

cmd_restart() {
  log_info "重启测试环境..."
  compose_cmd restart
  log_step "等待服务就绪..."
  wait_for_healthy
  log_info "重启完成"
  print_endpoints
}

cmd_rebuild() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    log_info "强制重新构建并启动: $service ..."
    ensure_dirs
    compose_cmd build --no-cache "$service"
    compose_cmd up -d --force-recreate "$service"
  else
    log_info "强制重新构建并启动所有服务..."
    ensure_dirs
    compose_cmd build --no-cache
    compose_cmd up -d --force-recreate
  fi
  log_step "等待服务就绪..."
  wait_for_healthy
  log_info "重建完成"
  print_endpoints
}

cmd_build() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    log_info "构建镜像: $service ..."
    compose_cmd build --no-cache "$service"
  else
    log_info "构建所有镜像..."
    compose_cmd build --no-cache
  fi
  log_info "镜像构建完成"

  log_step "镜像列表:"
  docker images --filter "reference=*tsign-test*" --format "  {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}" 2>/dev/null || true
}

cmd_status() {
  log_info "服务状态:"
  compose_cmd ps
}

cmd_logs() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    compose_cmd logs -f --tail=100 "$service"
  else
    compose_cmd logs -f --tail=100
  fi
}

cmd_health() {
  log_info "健康检查..."
  local all_ok=true

  for item in "Dispatcher:$DISPATCHER_PORT" "Receiver-B:$RECEIVER_B_PORT" "Receiver-C:$RECEIVER_C_PORT"; do
    local name="${item%%:*}"
    local port="${item##*:}"
    if curl -sf "http://localhost:$port/api/health" &>/dev/null; then
      echo -e "  ${GREEN}✓${NC} $name (port $port) - 正常"
    else
      echo -e "  ${RED}✗${NC} $name (port $port) - 不可用"
      all_ok=false
    fi
  done

  if $all_ok; then
    log_info "所有后端服务运行正常"
  else
    log_error "部分服务不可用"
    return 1
  fi
}

cmd_reset() {
  log_info "重置配置到初始状态..."

  log_step "复制初始配置文件"
  reset_configs

  log_step "重启所有后端服务"
  compose_cmd restart dispatcher receiver-b receiver-c

  log_step "等待服务就绪..."
  wait_for_healthy

  log_info "配置已重置，服务已重启"
}

cmd_clean() {
  log_warn "即将完全清理测试环境（容器、镜像、日志）"
  read -r -p "确认? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    log_info "已取消"
    return 0
  fi

  log_step "停止并移除容器和网络"
  compose_cmd down --remove-orphans --rmi local -v 2>/dev/null || true

  log_step "清理日志"
  rm -rf "$SCRIPT_DIR/logs"

  log_info "清理完成"
}

cmd_send() {
  local json_file="${1:-}"
  if [ -z "$json_file" ]; then
    log_error "请提供消息 JSON 文件路径"
    echo ""
    echo "用法: $0 send <json_file>"
    echo ""
    echo "示例 JSON 文件内容 (plaintext_message.json):"
    cat <<'EXAMPLE'
{
  "MsgType": "FlowStatusChange",
  "MsgId": "test-msg-001",
  "FlowId": "flow-test-123",
  "BusinessId": "biz-test-456",
  "FlowName": "测试合同",
  "FlowStatus": 2,
  "FlowMessage": "合同已完成",
  "CreateOn": 1700000000,
  "UpdatedOn": 1700001000
}
EXAMPLE
    return 1
  fi

  if [ ! -f "$json_file" ]; then
    log_error "文件不存在: $json_file"
    return 1
  fi

  # 读取 dispatcher 的上游加密 key 和 token
  local dispatcher_config="$SCRIPT_DIR/config/dispatcher/app.json"
  local encrypt_key
  local token
  encrypt_key=$(python3 -c "import json; c=json.load(open('$dispatcher_config')); print(c['tsign']['encryptKey'])")
  token=$(python3 -c "import json; c=json.load(open('$dispatcher_config')); print(c['tsign']['token'])")

  local message
  message=$(cat "$json_file")

  log_step "使用上游密钥加密消息并发送到 Dispatcher..."

  # 调用 Node.js 进行加密和签名（使用项目自带的 crypto 工具）
  local result
  result=$(node -e "
    const crypto = require('crypto');

    const encodingAESKey = '$encrypt_key';
    const token = '$token';
    const message = JSON.stringify($message);

    // encryptAES256CBC
    const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    const iv = aesKey.subarray(0, 16);
    const randomPrefix = crypto.randomBytes(16);
    const msgBuf = Buffer.from(message, 'utf-8');
    const msgLenBuf = Buffer.alloc(4);
    msgLenBuf.writeUInt32BE(msgBuf.length);
    const payload = Buffer.concat([randomPrefix, msgLenBuf, msgBuf]);
    const blockSize = 32;
    const padLen = blockSize - (payload.length % blockSize);
    const padding = Buffer.alloc(padLen, padLen);
    const padded = Buffer.concat([payload, padding]);
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');

    // generateSignature
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const arr = [token, timestamp, nonce, encrypted].sort();
    const signature = crypto.createHash('sha1').update(arr.join('')).digest('hex');

    console.log(JSON.stringify({ encrypted, timestamp, nonce, signature }));
  ")

  local encrypted timestamp nonce signature
  encrypted=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['encrypted'])")
  timestamp=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['timestamp'])")
  nonce=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['nonce'])")
  signature=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['signature'])")

  log_step "发送加密请求到 http://localhost:$DISPATCHER_PORT/api/callback"
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST \
    "http://localhost:$DISPATCHER_PORT/api/callback?timestamp=$timestamp&nonce=$nonce&msg_signature=$signature" \
    -H "Content-Type: application/json" \
    -d "{\"encrypt\": \"$encrypted\"}")

  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    log_info "发送成功 (HTTP $http_code)"
    echo -e "  响应: $body"
  else
    log_error "发送失败 (HTTP $http_code)"
    echo -e "  响应: $body"
    return 1
  fi
}

cmd_check() {
  log_info "查看各下游服务收到的回调:"
  echo ""

  for item in "Receiver-B:$RECEIVER_B_PORT" "Receiver-C:$RECEIVER_C_PORT"; do
    local name="${item%%:*}"
    local port="${item##*:}"
    echo -e "${CYAN}── $name (port $port) ──${NC}"
    local result
    result=$(curl -sf "http://localhost:$port/api/received-callbacks" 2>/dev/null) || result="(无法连接)"
    echo "$result" | python3 -m json.tool 2>/dev/null || echo "$result"
    echo ""
  done
}

cmd_clear() {
  log_info "清空所有下游服务的回调记录..."
  for item in "Receiver-B:$RECEIVER_B_PORT" "Receiver-C:$RECEIVER_C_PORT"; do
    local name="${item%%:*}"
    local port="${item##*:}"
    curl -sf -X DELETE "http://localhost:$port/api/received-callbacks" &>/dev/null \
      && echo -e "  ${GREEN}✓${NC} $name - 已清空" \
      || echo -e "  ${RED}✗${NC} $name - 清空失败"
  done
}

# ---- 辅助函数 ----

ensure_dirs() {
  mkdir -p "$SCRIPT_DIR/logs/dispatcher"
  mkdir -p "$SCRIPT_DIR/logs/receiver-b"
  mkdir -p "$SCRIPT_DIR/logs/receiver-c"
}

reset_configs() {
  # 使用 git checkout 恢复初始配置，如果不是 git 项目则从备份复制
  local config_base="$SCRIPT_DIR/config"

  # 重置 dispatcher 的 callbacks 配置
  cat > "$config_base/dispatcher/callbacks.json" <<'EOF'
{
  "version": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "callbacks": [
    {
      "id": "test-receiver-b",
      "name": "下游服务B",
      "url": "http://receiver-b:3001/api/callback",
      "appType": "company",
      "tags": [],
      "matchRules": [],
      "enabled": true,
      "retryCount": 3,
      "timeout": 10000,
      "headers": {},
      "msgTypes": [],
      "unknownMsgTypePolicy": "dispatch",
      "encryptKey": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "signToken": "test_receiver_b_token_123456",
      "reEncrypt": true,
      "remark": "测试下游接收者 B（二次加密）",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "test-receiver-c",
      "name": "下游服务C",
      "url": "http://receiver-c:3001/api/callback",
      "appType": "company",
      "tags": [],
      "matchRules": [],
      "enabled": true,
      "retryCount": 3,
      "timeout": 10000,
      "headers": {},
      "msgTypes": [],
      "unknownMsgTypePolicy": "dispatch",
      "encryptKey": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      "signToken": "test_receiver_c_token_123456",
      "reEncrypt": true,
      "remark": "测试下游接收者 C（二次加密）",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
EOF

  # 重置 receiver-b 和 receiver-c 的 callbacks 为空
  for svc in receiver-b receiver-c; do
    cat > "$config_base/$svc/callbacks.json" <<'EOF'
{
  "version": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "callbacks": []
}
EOF
  done

  log_info "配置已恢复到初始状态"
}

wait_for_healthy() {
  local max_wait=60
  local interval=2
  local elapsed=0

  while [ $elapsed -lt $max_wait ]; do
    local ready=0
    for port in $DISPATCHER_PORT $RECEIVER_B_PORT $RECEIVER_C_PORT; do
      if curl -sf "http://localhost:$port/api/health" &>/dev/null; then
        ready=$((ready + 1))
      fi
    done

    if [ $ready -eq 3 ]; then
      log_info "所有后端服务已就绪 (${elapsed}s)"
      return 0
    fi

    sleep $interval
    elapsed=$((elapsed + interval))
    echo -ne "\r  等待中... ${elapsed}s (${ready}/3 就绪)"
  done

  echo ""
  log_error "等待超时 (${max_wait}s)，部分服务未就绪"
  cmd_status
  return 1
}

print_endpoints() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo -e "${CYAN}  测试环境端点${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo -e "  Dispatcher (A):  http://localhost:${DISPATCHER_PORT}"
  echo -e "  Receiver B:      http://localhost:${RECEIVER_B_PORT}"
  echo -e "  Receiver C:      http://localhost:${RECEIVER_C_PORT}"
  echo -e "  管理前端:         http://localhost:${FRONTEND_PORT}"
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo ""
  echo -e "  快速操作:"
  echo -e "    发送测试: ${YELLOW}./test-env.sh send message.json${NC}"
  echo -e "    查看回调: ${YELLOW}./test-env.sh check${NC}"
  echo -e "    清空记录: ${YELLOW}./test-env.sh clear${NC}"
  echo -e "    查看日志: ${YELLOW}./test-env.sh logs [dispatcher|receiver-b|receiver-c]${NC}"
  echo ""
}

print_usage() {
  echo "用法: $0 <command> [args]"
  echo ""
  echo "命令:"
  echo "  up          构建并启动所有测试容器"
  echo "  down        停止并移除所有容器、网络"
  echo "  restart     重启所有服务"
  echo "  rebuild [svc] 强制重新构建镜像（--no-cache）并启动（可指定服务）"
  echo "  build [svc]   仅构建镜像，不启动（可指定服务）"
  echo "  status      查看服务状态"
  echo "  logs [svc]  查看服务日志（可指定 dispatcher/receiver-b/receiver-c/frontend）"
  echo "  health      健康检查所有后端服务"
  echo "  reset       重置配置到初始状态并重启"
  echo "  clean       完全清理：容器、镜像、日志"
  echo "  send <file> 向 dispatcher 发送加密测试回调"
  echo "  check       查看 receiver-b/c 收到的回调"
  echo "  clear       清空 receiver-b/c 的回调记录"
  echo ""
  echo "架构:"
  echo "  上游请求 → Dispatcher (:$DISPATCHER_PORT) → Receiver-B (:$RECEIVER_B_PORT)"
  echo "                                           → Receiver-C (:$RECEIVER_C_PORT)"
  echo "  管理前端 → http://localhost:$FRONTEND_PORT"
}

# ---- 入口 ----

command="${1:-}"
shift || true

case "$command" in
  up)       cmd_up ;;
  down)     cmd_down ;;
  restart)  cmd_restart ;;
  rebuild)  cmd_rebuild "$@" ;;
  build)    cmd_build "$@" ;;
  status)   cmd_status ;;
  logs)     cmd_logs "$@" ;;
  health)   cmd_health ;;
  reset)    cmd_reset ;;
  clean)    cmd_clean ;;
  send)     cmd_send "$@" ;;
  check)    cmd_check ;;
  clear)    cmd_clear ;;
  *)        print_usage ;;
esac
