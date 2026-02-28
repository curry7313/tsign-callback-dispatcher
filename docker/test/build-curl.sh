#!/usr/bin/env bash
# ============================================================================
# 构造测试请求脚本
#
# 从 docker/test/bodys 读取明文消息体（每行一条 JSON），
# 用 dispatcher 的上游密钥（encryptKey/token）加密并签名，
# 生成可直接执行的 curl 命令。
#
# 用法:
#   ./build-curl.sh [选项]
#
# 选项:
#   -n <行号>           只处理 bodys 文件的第 N 行（从1开始），默认处理所有行
#   -x                  直接执行 curl 命令（而非仅打印）
#   -o <文件>           将 curl 命令输出到文件
#   -t <目标URL>        指定目标URL（默认: http://localhost:5001/api/callback）
#   -d                  启用调试模式，输出加密中间步骤
#   -h                  显示帮助
#
# 示例:
#   ./build-curl.sh
#   ./build-curl.sh -n 1 -x
#   ./build-curl.sh -o curls.sh
#   ./build-curl.sh -d -n 1          # 调试模式
#   ./build-curl.sh -n 3 -x -t http://localhost:3001/api/callback
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BODYS_FILE="$SCRIPT_DIR/bodys"
DISPATCHER_CONFIG="$SCRIPT_DIR/config/dispatcher/app.json"
ENCRYPT_JS="$SCRIPT_DIR/encrypt-builder.js"

# 默认值
LINE_NUM=""
EXECUTE=false
OUTPUT_FILE=""
TARGET_URL="http://localhost:5001/api/callback"
DEBUG="0"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  echo "用法: $0 [选项]"
  echo ""
  echo "从 bodys 文件读取明文消息，加密后生成 curl 命令发送到 dispatcher。"
  echo ""
  echo "选项:"
  echo "  -n <行号>       只处理第 N 行（从1开始），默认处理所有行"
  echo "  -x              直接执行生成的 curl 命令"
  echo "  -o <文件>       将 curl 命令输出到文件"
  echo "  -t <URL>        目标URL（默认: http://localhost:5001/api/callback）"
  echo "  -d              调试模式（打印加密中间步骤到 stderr）"
  echo "  -h              显示帮助"
  echo ""
  echo "示例:"
  echo "  $0 -n 1 -x"
  echo "  $0 -o curls.sh"
  echo "  $0 -d -n 1      # 调试单行"
  echo ""
  echo "加密逻辑在 encrypt-builder.js 中，可单独调试:"
  echo "  DEBUG=1 ENCRYPT_KEY=xxx BODYS_FILE=./bodys TARGET_URL=http://... node encrypt-builder.js"
  exit 0
}

# 解析参数
while getopts "n:xo:t:dh" opt; do
  case $opt in
    n) LINE_NUM="$OPTARG" ;;
    x) EXECUTE=true ;;
    o) OUTPUT_FILE="$OPTARG" ;;
    t) TARGET_URL="$OPTARG" ;;
    d) DEBUG="1" ;;
    h) usage ;;
    *) usage ;;
  esac
done

# 校验
if [ ! -f "$BODYS_FILE" ]; then
  echo -e "${RED}[ERROR]${NC} bodys 文件不存在: $BODYS_FILE"
  exit 1
fi

if [ ! -f "$DISPATCHER_CONFIG" ]; then
  echo -e "${RED}[ERROR]${NC} Dispatcher 配置不存在: $DISPATCHER_CONFIG"
  exit 1
fi

if [ ! -f "$ENCRYPT_JS" ]; then
  echo -e "${RED}[ERROR]${NC} 加密脚本不存在: $ENCRYPT_JS"
  echo -e "  请确保 encrypt-builder.js 与本脚本在同一目录"
  exit 1
fi

# 读取 encryptKey 和 Token（dispatcher 的上游密钥）
ENCRYPT_KEY=$(python3 -c "import json; c=json.load(open('$DISPATCHER_CONFIG')); print(c['tsign']['encryptKey'])")
TOKEN=$(python3 -c "import json; c=json.load(open('$DISPATCHER_CONFIG')); print(c['tsign'].get('token', ''))")

if [ -z "$ENCRYPT_KEY" ]; then
  echo -e "${RED}[ERROR]${NC} 无法从 dispatcher 配置读取 encryptKey"
  exit 1
fi

echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}  构造测试请求${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "  加密Key:  ${ENCRYPT_KEY:0:10}... (${#ENCRYPT_KEY} 字符)"
if [ -n "$TOKEN" ]; then
  echo -e "  Token:    ${TOKEN:0:10}..."
else
  echo -e "  Token:    ${YELLOW}(空，不带签名参数)${NC}"
fi
echo -e "  目标:     $TARGET_URL"
if [ "$DEBUG" = "1" ]; then
  echo -e "  调试:     ${YELLOW}ON${NC}"
fi
echo ""

# 调用独立 JS 文件完成加密
# stderr (debug日志) 直接输出到终端，stdout (JSON结果) 捕获到变量
export ENCRYPT_KEY TOKEN BODYS_FILE LINE_NUM TARGET_URL DEBUG

CURLS=$(node "$ENCRYPT_JS") || {
  echo -e "${RED}[ERROR]${NC} 加密处理失败"
  echo ""
  echo -e "${YELLOW}提示:${NC} 可用 -d 参数开启调试模式，或直接运行 JS 调试:"
  echo "  DEBUG=1 ENCRYPT_KEY=\"$ENCRYPT_KEY\" BODYS_FILE=\"$BODYS_FILE\" TARGET_URL=\"$TARGET_URL\" node $ENCRYPT_JS"
  exit 1
}

# 从输出中分离 stderr (debug) 和 stdout (json)
# node 的 stderr 已直接输出，stdout 是 JSON 结果
# 提取最后一行作为 JSON（debug 信息在 stderr 不会混入）

# 解析并输出
TOTAL=$(echo "$CURLS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
OUTPUT_CONTENT=""

for i in $(seq 0 $((TOTAL - 1))); do
  IDX=$(echo "$CURLS" | python3 -c "import sys,json; d=json.load(sys.stdin)[$i]; print(d.get('idx','?'))")
  ERROR=$(echo "$CURLS" | python3 -c "import sys,json; d=json.load(sys.stdin)[$i]; print(d.get('error',''))")

  if [ -n "$ERROR" ]; then
    echo -e "${RED}[#$IDX] 处理失败:${NC} $ERROR"
    continue
  fi

  PREVIEW=$(echo "$CURLS" | python3 -c "import sys,json; d=json.load(sys.stdin)[$i]; print(d['preview'])")
  CURL_CMD=$(echo "$CURLS" | python3 -c "import sys,json; d=json.load(sys.stdin)[$i]; print(d['curl'])")

  echo -e "${GREEN}[#$IDX]${NC} 明文预览:"
  echo -e "  ${CYAN}$PREVIEW${NC}"
  echo ""
  echo -e "${YELLOW}curl 命令:${NC}"
  echo "$CURL_CMD"
  echo ""

  if [ -n "$OUTPUT_FILE" ]; then
    OUTPUT_CONTENT+="# 第 ${IDX} 条消息"$'\n'
    OUTPUT_CONTENT+="$CURL_CMD"$'\n'$'\n'
  fi

  if $EXECUTE; then
    echo -e "${GREEN}[执行中...]${NC}"
    eval "$CURL_CMD" && echo "" || echo -e "${RED}执行失败${NC}"
    echo ""
  fi

  echo "────────────────────────────────────────"
  echo ""
done

if [ -n "$OUTPUT_FILE" ]; then
  echo "#!/usr/bin/env bash" > "$OUTPUT_FILE"
  echo "# 自动生成的 curl 测试命令" >> "$OUTPUT_FILE"
  echo "# 生成时间: $(date)" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "$OUTPUT_CONTENT" >> "$OUTPUT_FILE"
  chmod +x "$OUTPUT_FILE"
  echo -e "${GREEN}[INFO]${NC} curl 命令已写入: $OUTPUT_FILE"
fi

echo -e "${GREEN}[完成]${NC} 共处理 $TOTAL 条消息"
