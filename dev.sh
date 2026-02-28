#!/usr/bin/env bash
# ============================================================================
# 本地开发调试 启动 / 关闭 脚本
#
# 用法:
#   ./dev.sh start          # 启动后端 + 前端（后台运行）
#   ./dev.sh start backend  # 仅启动后端
#   ./dev.sh start frontend # 仅启动前端
#   ./dev.sh stop           # 停止所有服务
#   ./dev.sh stop backend   # 仅停止后端
#   ./dev.sh stop frontend  # 仅停止前端
#   ./dev.sh restart        # 重启所有服务
#   ./dev.sh status         # 查看运行状态
#   ./dev.sh logs           # 查看后端日志（跟随模式）
#   ./dev.sh logs frontend  # 查看前端日志（跟随模式）
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PID_DIR="$SCRIPT_DIR/.dev-pids"
LOG_DIR="$SCRIPT_DIR/logs/dev"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${BLUE}[STEP]${NC}  $*"; }

ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
}

# ---- 检查依赖 ----

check_deps() {
  local target="${1:-all}"

  if [[ "$target" == "all" || "$target" == "backend" ]]; then
    if [ ! -d "$BACKEND_DIR/node_modules" ]; then
      log_step "安装后端依赖..."
      (cd "$BACKEND_DIR" && npm install)
    fi
  fi

  if [[ "$target" == "all" || "$target" == "frontend" ]]; then
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
      log_step "安装前端依赖..."
      (cd "$FRONTEND_DIR" && npm install)
    fi
  fi
}

# ---- 进程管理 ----

is_running() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    # PID 文件存在但进程不在，清理
    rm -f "$pid_file"
  fi
  return 1
}

get_pid() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [ -f "$pid_file" ]; then
    cat "$pid_file"
  fi
}

start_backend() {
  if is_running backend; then
    log_warn "后端已在运行 (PID: $(get_pid backend))"
    return 0
  fi

  log_step "启动后端服务..."
  (cd "$BACKEND_DIR" && nohup npm run dev > "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$PID_DIR/backend.pid"
  )

  sleep 1
  if is_running backend; then
    log_info "后端已启动 (PID: $(get_pid backend))"
  else
    log_error "后端启动失败，查看日志: $LOG_DIR/backend.log"
    return 1
  fi
}

start_frontend() {
  if is_running frontend; then
    log_warn "前端已在运行 (PID: $(get_pid frontend))"
    return 0
  fi

  log_step "启动前端服务..."
  (cd "$FRONTEND_DIR" && nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$PID_DIR/frontend.pid"
  )

  sleep 1
  if is_running frontend; then
    log_info "前端已启动 (PID: $(get_pid frontend))"
  else
    log_error "前端启动失败，查看日志: $LOG_DIR/frontend.log"
    return 1
  fi
}

stop_service() {
  local name="$1"
  local display_name="$2"

  if ! is_running "$name"; then
    log_info "$display_name 未在运行"
    return 0
  fi

  local pid
  pid=$(get_pid "$name")
  log_step "停止 $display_name (PID: $pid)..."

  # 先发 SIGTERM，等待优雅退出
  kill "$pid" 2>/dev/null || true

  # 等待进程退出（最多 5 秒）
  local wait=0
  while kill -0 "$pid" 2>/dev/null && [ $wait -lt 5 ]; do
    sleep 1
    wait=$((wait + 1))
  done

  # 还没退出就 SIGKILL
  if kill -0 "$pid" 2>/dev/null; then
    log_warn "$display_name 未响应 SIGTERM，强制终止..."
    kill -9 "$pid" 2>/dev/null || true
  fi

  # 清理子进程（ts-node-dev / vite 可能 fork 子进程）
  pkill -P "$pid" 2>/dev/null || true

  rm -f "$PID_DIR/$name.pid"
  log_info "$display_name 已停止"
}

# ---- 子命令 ----

cmd_start() {
  local target="${1:-all}"
  ensure_dirs
  check_deps "$target"

  case "$target" in
    all)
      start_backend
      start_frontend
      ;;
    backend)  start_backend ;;
    frontend) start_frontend ;;
    *)
      log_error "未知服务: $target (可选: backend, frontend)"
      return 1
      ;;
  esac

  echo ""
  cmd_status
  print_endpoints
}

cmd_stop() {
  local target="${1:-all}"

  case "$target" in
    all)
      stop_service backend "后端"
      stop_service frontend "前端"
      ;;
    backend)  stop_service backend "后端" ;;
    frontend) stop_service frontend "前端" ;;
    *)
      log_error "未知服务: $target (可选: backend, frontend)"
      return 1
      ;;
  esac
}

cmd_restart() {
  local target="${1:-all}"
  cmd_stop "$target"
  sleep 1
  cmd_start "$target"
}

cmd_status() {
  echo -e "${CYAN}服务状态:${NC}"
  for name in backend frontend; do
    if is_running "$name"; then
      echo -e "  ${GREEN}●${NC} $name — 运行中 (PID: $(get_pid $name))"
    else
      echo -e "  ${RED}●${NC} $name — 已停止"
    fi
  done
}

cmd_logs() {
  local target="${1:-backend}"
  local log_file="$LOG_DIR/$target.log"

  if [ ! -f "$log_file" ]; then
    log_error "日志文件不存在: $log_file"
    return 1
  fi

  tail -f "$log_file"
}

print_endpoints() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo -e "${CYAN}  本地开发端点${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo -e "  后端 API:   http://localhost:3001"
  echo -e "  前端页面:   http://localhost:3000"
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo ""
}

print_usage() {
  echo "用法: $0 <command> [service]"
  echo ""
  echo "命令:"
  echo "  start [service]    启动服务（默认全部）"
  echo "  stop  [service]    停止服务（默认全部）"
  echo "  restart [service]  重启服务（默认全部）"
  echo "  status             查看运行状态"
  echo "  logs [service]     查看日志（默认 backend）"
  echo ""
  echo "service 可选: backend, frontend"
  echo ""
  echo "示例:"
  echo "  $0 start            # 启动前后端"
  echo "  $0 start backend    # 仅启动后端"
  echo "  $0 stop             # 停止所有"
  echo "  $0 logs             # 查看后端日志"
  echo "  $0 logs frontend    # 查看前端日志"
}

# ---- 入口 ----

command="${1:-}"
shift || true

case "$command" in
  start)    cmd_start "$@" ;;
  stop)     cmd_stop "$@" ;;
  restart)  cmd_restart "$@" ;;
  status)   cmd_status ;;
  logs)     cmd_logs "$@" ;;
  *)        print_usage ;;
esac
