#!/usr/bin/env bash
#
# TSign Callback Dispatcher - 性能测试管理脚本
#
# 用法:
#   ./perf-test.sh up                    # 启动基础设施 (dispatcher + InfluxDB + Grafana)
#   ./perf-test.sh run [scenario]        # 运行 K6 压测 (scenario: smoke|load|stress|soak)
#   ./perf-test.sh run-encrypted [scenario]  # 使用真实加密消息运行压测
#   ./perf-test.sh dash                  # 打开 Grafana 面板
#   ./perf-test.sh status                # 查看服务状态
#   ./perf-test.sh logs [service]        # 查看日志
#   ./perf-test.sh down                  # 关闭所有服务
#   ./perf-test.sh clean [--images]       # 彻底清理 (--images 同时删除镜像)
#   ./perf-test.sh gen-data              # 预生成加密消息数据
#   ./perf-test.sh report                # 查看最近的测试结果
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.perf.yml"
K6_DIR="$SCRIPT_DIR/k6"
K6_SCRIPTS="$K6_DIR/scripts"
K6_DATA="$K6_DIR/data"
K6_RESULTS="$K6_DIR/results"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 配置
DISPATCHER_URL="http://localhost:5001"
INFLUXDB_URL="http://localhost:8086"
GRAFANA_URL="http://localhost:3030"
ENCRYPT_KEY="CC23FB38AE1D47B09D939CFBAE64195F"
TOKEN=""

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "${BLUE}[STEP]${NC} $*"; }

# ──── 确保 K6 已安装 ────
ensure_k6() {
  if command -v k6 &>/dev/null; then
    info "K6 已安装: $(k6 version 2>/dev/null | head -1)"
    return 0
  fi

  warn "K6 未安装，尝试自动安装..."
  if [[ "$(uname)" == "Darwin" ]]; then
    if command -v brew &>/dev/null; then
      brew install k6
    else
      error "请先安装 Homebrew 或手动安装 K6: https://k6.io/docs/getting-started/installation/"
      exit 1
    fi
  elif [[ "$(uname)" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo gpg -k >/dev/null 2>&1 || true
      sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 2>/dev/null
      echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
      sudo apt-get update && sudo apt-get install k6 -y
    else
      error "请手动安装 K6: https://k6.io/docs/getting-started/installation/"
      exit 1
    fi
  else
    error "不支持的操作系统，请手动安装 K6: https://k6.io/docs/getting-started/installation/"
    exit 1
  fi

  if command -v k6 &>/dev/null; then
    info "K6 安装成功: $(k6 version 2>/dev/null | head -1)"
  else
    error "K6 安装失败"
    exit 1
  fi
}

# ──── 等待服务健康 ────
wait_healthy() {
  local url="$1"
  local name="$2"
  local max_wait="${3:-60}"
  local elapsed=0

  while [ $elapsed -lt $max_wait ]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      info "$name 已就绪 (${elapsed}s)"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    printf "."
  done
  echo
  error "$name 在 ${max_wait}s 内未就绪"
  return 1
}

# ──── 命令: up ────
cmd_up() {
  step "构建并启动性能测试基础设施..."

  # 创建必要目录
  mkdir -p "$K6_DATA" "$K6_RESULTS"
  mkdir -p "$SCRIPT_DIR/logs/dispatcher" "$SCRIPT_DIR/logs/receiver-b" "$SCRIPT_DIR/logs/receiver-c"

  docker compose -f "$COMPOSE_FILE" build
  docker compose -f "$COMPOSE_FILE" up -d

  echo
  step "等待服务就绪..."
  wait_healthy "$DISPATCHER_URL/api/health" "Dispatcher" 60
  wait_healthy "$INFLUXDB_URL/ping" "InfluxDB" 30
  wait_healthy "$GRAFANA_URL/api/health" "Grafana" 30

  echo
  info "═══════════════════════════════════════════"
  info "性能测试基础设施已就绪!"
  info ""
  info "  Dispatcher:  $DISPATCHER_URL"
  info "  InfluxDB:    $INFLUXDB_URL"
  info "  Grafana:     $GRAFANA_URL"
  info ""
  info "下一步:"
  info "  1. 打开 Grafana:  ${CYAN}./perf-test.sh dash${NC}"
  info "  2. 运行压测:      ${CYAN}./perf-test.sh run [smoke|load|stress|soak]${NC}"
  info "═══════════════════════════════════════════"
}

# ──── 通过 API 获取/设置 TSign 配置（确保内存同步） ────
get_tsign_config() {
  curl -sf "$DISPATCHER_URL/api/tsign-config" 2>/dev/null || echo "{}"
}

set_tsign_config() {
  local key="$1"
  local tkn="$2"
  local resp
  resp=$(curl -sf -X PUT "$DISPATCHER_URL/api/tsign-config" \
    -H "Content-Type: application/json" \
    -d "{\"encryptKey\":\"$key\",\"token\":\"$tkn\"}" 2>/dev/null)
  if echo "$resp" | grep -q '"code":0'; then
    return 0
  else
    error "设置 TSign 配置失败: $resp"
    return 1
  fi
}

# ──── 命令: run ────
cmd_run() {
  local scenario="${1:-load}"
  ensure_k6

  info "运行 K6 压测 [场景: $scenario] ..."
  mkdir -p "$K6_RESULTS"

  local result_file="$K6_RESULTS/$(date +%Y%m%d_%H%M%S)_${scenario}.json"

  # 通过 API 清空 encryptKey（直接更新服务内存，不依赖文件热重载）
  step "配置 dispatcher 为明文模式 (无加密)..."
  local original_config
  original_config=$(get_tsign_config)
  local original_key
  original_key=$(echo "$original_config" | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log((d.data&&d.data.encryptKey)||'');
  " 2>/dev/null || echo "$ENCRYPT_KEY")
  local original_token
  original_token=$(echo "$original_config" | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log((d.data&&d.data.token)||'');
  " 2>/dev/null || echo "$TOKEN")

  if set_tsign_config "" "$original_token"; then
    info "已通过 API 清空 encryptKey (明文模式)"
  else
    warn "API 设置失败，尝试直接修改配置文件..."
    local app_json="$SCRIPT_DIR/config/dispatcher/app.json"
    if [ -f "$app_json" ]; then
      node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('$app_json', 'utf8'));
        cfg.tsign = cfg.tsign || {};
        cfg.tsign.encryptKey = '';
        fs.writeFileSync('$app_json', JSON.stringify(cfg, null, 2));
      " 2>/dev/null
      warn "已修改配置文件，但需重启容器才能生效: docker compose -f $COMPOSE_FILE restart dispatcher"
    fi
  fi

  step "开始压测..."
  echo
  k6 run \
    --out influxdb="$INFLUXDB_URL/k6" \
    --summary-export="$result_file" \
    -e TARGET_URL="$DISPATCHER_URL/api/callback" \
    -e ENCRYPT_KEY="" \
    -e TOKEN="$TOKEN" \
    -e SCENARIO="$scenario" \
    "$K6_SCRIPTS/load-test.js" || true

  # 恢复 encryptKey
  step "恢复 dispatcher 加密配置..."
  if set_tsign_config "$original_key" "$original_token"; then
    info "已通过 API 恢复 encryptKey"
  else
    local app_json="$SCRIPT_DIR/config/dispatcher/app.json"
    if [ -f "$app_json" ]; then
      node -e "
        const fs = require('fs');
        const cfg = JSON.parse(fs.readFileSync('$app_json', 'utf8'));
        cfg.tsign = cfg.tsign || {};
        cfg.tsign.encryptKey = '$original_key';
        fs.writeFileSync('$app_json', JSON.stringify(cfg, null, 2));
      " 2>/dev/null
    fi
  fi

  echo
  info "测试结果已保存: $result_file"
  info "Grafana 面板: $GRAFANA_URL"
}

# ──── 命令: gen-data ────
cmd_gen_data() {
  step "预生成加密消息数据..."
  mkdir -p "$K6_DATA"

  local bodys_file="$SCRIPT_DIR/bodys"
  if [ ! -f "$bodys_file" ]; then
    error "bodys 文件不存在: $bodys_file"
    exit 1
  fi

  # 使用 encrypt-builder.js 生成加密消息
  local encrypt_script="$SCRIPT_DIR/encrypt-builder.js"
  if [ ! -f "$encrypt_script" ]; then
    error "encrypt-builder.js 不存在"
    exit 1
  fi

  ENCRYPT_KEY="$ENCRYPT_KEY" \
  TOKEN="$TOKEN" \
  BODYS_FILE="$bodys_file" \
  TARGET_URL="$DISPATCHER_URL/api/callback" \
  node "$encrypt_script" > /tmp/k6-raw-encrypted.json 2>/dev/null

  # 转换为 K6 可读格式: [{encrypt: "base64...", preview: "..."}, ...]
  node -e "
    const raw = JSON.parse(require('fs').readFileSync('/tmp/k6-raw-encrypted.json', 'utf8'));
    const messages = raw.filter(r => !r.error).map(r => {
      // 从 curl 命令中提取 body
      const match = r.curl.match(/-d '(.+)'/);
      if (!match) return null;
      const body = JSON.parse(match[1]);
      return { encrypt: body.encrypt, preview: r.preview };
    }).filter(Boolean);

    // 复制多份以增加消息池大小 (至少 200 条)
    const pool = [];
    while (pool.length < 200) {
      pool.push(...messages);
    }
    require('fs').writeFileSync('$K6_DATA/encrypted-messages.json', JSON.stringify(pool));
    console.log('Generated ' + pool.length + ' encrypted messages');
  "

  rm -f /tmp/k6-raw-encrypted.json
  info "加密消息数据已生成: $K6_DATA/encrypted-messages.json"
}

# ──── 命令: run-encrypted ────
cmd_run_encrypted() {
  local scenario="${1:-load}"
  ensure_k6

  # 确保加密数据存在
  if [ ! -f "$K6_DATA/encrypted-messages.json" ]; then
    warn "加密消息数据不存在，先生成..."
    cmd_gen_data
  fi

  info "运行 K6 加密压测 [场景: $scenario] ..."
  mkdir -p "$K6_RESULTS"
  local result_file="$K6_RESULTS/$(date +%Y%m%d_%H%M%S)_encrypted_${scenario}.json"

  step "开始加密压测..."
  echo
  k6 run \
    --out influxdb="$INFLUXDB_URL/k6" \
    --summary-export="$result_file" \
    -e TARGET_URL="$DISPATCHER_URL/api/callback" \
    -e TOKEN="$TOKEN" \
    -e SCENARIO="$scenario" \
    -e DATA_FILE="$K6_DATA/encrypted-messages.json" \
    "$K6_SCRIPTS/encrypt-load-test.js" || true

  echo
  info "测试结果已保存: $result_file"
  info "Grafana 面板: $GRAFANA_URL"
}

# ──── 命令: dash ────
cmd_dash() {
  local dashboard_url="$GRAFANA_URL/d/tsign-k6-perf/tsign-callback-dispatcher-k6-performance?orgId=1&refresh=5s"
  info "打开 Grafana K6 面板..."
  info "URL: $dashboard_url"

  if [[ "$(uname)" == "Darwin" ]]; then
    open "$dashboard_url"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$dashboard_url"
  else
    info "请手动打开上方 URL"
  fi
}

# ──── 命令: status ────
cmd_status() {
  echo -e "${CYAN}════ 服务状态 ════${NC}"
  docker compose -f "$COMPOSE_FILE" ps

  echo
  echo -e "${CYAN}════ 健康检查 ════${NC}"
  for svc in "Dispatcher:$DISPATCHER_URL/api/health" "InfluxDB:$INFLUXDB_URL/ping" "Grafana:$GRAFANA_URL/api/health"; do
    local name="${svc%%:*}"
    local url="${svc#*:}"
    if curl -sf "$url" >/dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} $name"
    else
      echo -e "  ${RED}✗${NC} $name"
    fi
  done
}

# ──── 命令: logs ────
cmd_logs() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$service"
  else
    docker compose -f "$COMPOSE_FILE" logs -f --tail=50
  fi
}

# ──── 命令: down ────
cmd_down() {
  step "关闭性能测试基础设施..."
  docker compose -f "$COMPOSE_FILE" down
  info "已关闭"
}

# ──── 命令: clean [--images] ────
cmd_clean() {
  local remove_images=false
  for arg in "$@"; do
    case "$arg" in
      --images) remove_images=true ;;
    esac
  done

  step "彻底清理性能测试环境..."

  # 1. 停止并移除容器、网络、数据卷
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  info "容器、网络、数据卷已清理"

  # 2. 清理构建的镜像 (仅在 --images 选项时)
  if $remove_images; then
    local images
    images=$(docker compose -f "$COMPOSE_FILE" config --images 2>/dev/null || true)
    if [ -n "$images" ]; then
      echo "$images" | xargs -r docker rmi -f 2>/dev/null || true
      info "相关镜像已清理"
    fi
    # 清理悬空镜像 (仅限本项目相关)
    docker image prune -f --filter "label=project=tsign-perf-test" 2>/dev/null || true
  else
    info "跳过镜像清理 (使用 --images 选项可同时删除镜像)"
  fi

  # 3. 清理 K6 数据和结果
  rm -rf "$K6_DATA"/*.json 2>/dev/null || true
  rm -rf "$K6_RESULTS"/*.json 2>/dev/null || true
  info "K6 数据和结果已清理"

  # 4. 清理日志
  rm -rf "$SCRIPT_DIR/logs/dispatcher"/*.log 2>/dev/null || true
  rm -rf "$SCRIPT_DIR/logs/receiver-b"/*.log 2>/dev/null || true
  rm -rf "$SCRIPT_DIR/logs/receiver-c"/*.log 2>/dev/null || true
  info "日志已清理"

  echo
  info "性能测试环境已彻底清理"
}

# ──── 命令: report ────
cmd_report() {
  if [ ! -d "$K6_RESULTS" ] || [ -z "$(ls -A "$K6_RESULTS" 2>/dev/null)" ]; then
    warn "没有测试结果文件"
    return
  fi

  echo -e "${CYAN}════ 测试结果汇总 ════${NC}"
  for f in "$K6_RESULTS"/*.json; do
    [ -f "$f" ] || continue
    local basename=$(basename "$f")
    local ts="${basename%%_*}"
    local scenario="${basename#*_}"
    scenario="${scenario%.json}"

    echo
    echo -e "${BLUE}▸ $basename${NC}"

    # 提取关键指标
    node -e "
      const fs = require('fs');
      try {
        const data = JSON.parse(fs.readFileSync('$f', 'utf8'));
        const metrics = data.metrics || {};
        const dur = metrics.http_req_duration || {};
        const reqs = metrics.http_reqs || {};
        const failed = metrics.http_req_failed || {};

        if (dur.values) {
          console.log('  平均响应时间:  ' + (dur.values.avg || 0).toFixed(2) + 'ms');
          console.log('  P95 响应时间:  ' + (dur.values['p(95)'] || 0).toFixed(2) + 'ms');
          console.log('  P99 响应时间:  ' + (dur.values['p(99)'] || 0).toFixed(2) + 'ms');
          console.log('  最大响应时间:  ' + (dur.values.max || 0).toFixed(2) + 'ms');
        }
        if (reqs.values) {
          console.log('  总请求数:      ' + (reqs.values.count || 0));
          console.log('  平均 RPS:      ' + (reqs.values.rate || 0).toFixed(2));
        }
        if (failed.values) {
          console.log('  错误率:        ' + ((failed.values.rate || 0) * 100).toFixed(2) + '%');
        }
      } catch(e) {
        console.log('  (无法解析)');
      }
    " 2>/dev/null
  done
}

# ──── 帮助 ────
cmd_help() {
  cat << 'EOF'
TSign Callback Dispatcher - 性能测试工具

用法: ./perf-test.sh <command> [args]

命令:
  up                          启动基础设施 (Dispatcher + InfluxDB + Grafana)
  run [scenario]              运行明文模式压测
  run-encrypted [scenario]    运行加密模式压测 (使用预生成的真实加密消息)
  gen-data                    预生成加密消息数据
  dash                        打开 Grafana K6 面板
  status                      查看服务状态
  logs [service]              查看日志
  report                      查看历史测试结果
  down                        关闭所有服务
  clean [--images]              彻底清理 (默认保留镜像, --images 同时删除)
  help                        显示帮助

测试场景 (scenario):
  smoke     冒烟测试:  1 VU,  30s
  load      负载测试:  0→20→50 VU, 3.5min (默认)
  stress    压力测试:  0→50→100→200 VU, 5min
  soak      耐久测试:  30 VU, 10min

示例:
  ./perf-test.sh up                   # 启动
  ./perf-test.sh run smoke            # 冒烟测试
  ./perf-test.sh run load             # 负载测试
  ./perf-test.sh run-encrypted stress # 加密压力测试
  ./perf-test.sh dash                 # 查看 Grafana
  ./perf-test.sh report               # 查看结果
  ./perf-test.sh down                 # 关闭

架构:
  K6 (本地) → Dispatcher (Docker:5001) → Receiver-B/C (Docker:5002/5003)
      ↓
  InfluxDB (Docker:8086) → Grafana (Docker:3030)

EOF
}

# ──── 主入口 ────
case "${1:-help}" in
  up)             cmd_up ;;
  run)            cmd_run "${2:-load}" ;;
  run-encrypted)  cmd_run_encrypted "${2:-load}" ;;
  gen-data)       cmd_gen_data ;;
  dash)           cmd_dash ;;
  status)         cmd_status ;;
  logs)           cmd_logs "${2:-}" ;;
  down)           cmd_down ;;
  clean)          shift; cmd_clean "$@" ;;
  report)         cmd_report ;;
  help|--help|-h) cmd_help ;;
  *)
    error "未知命令: $1"
    cmd_help
    exit 1
    ;;
esac
