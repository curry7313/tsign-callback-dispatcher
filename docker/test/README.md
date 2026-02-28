```
docker/test/
├── docker-compose.test.yml     # 三实例 + 前端 compose 配置
├── nginx.test.conf             # 前端 nginx 代理指向 dispatcher
├── test-env.sh                 # 完整生命周期管理脚本
├── sample-message.json         # 示例测试消息
└── config/
    ├── dispatcher/             # 分发服务配置（A: 端口 5001）
    │   ├── app.json            # 上游加密 key + token
    │   ├── callbacks.json      # 预配置了 B 和 C 两个下游（reEncrypt=true）
    │   ├── tags.json
    │   └── operation-logs.json
    ├── receiver-b/             # 下游 B 配置（端口 5002）
    │   ├── app.json            # tsign key 与 dispatcher→B 的 encryptKey 一致
    │   └── ...
    └── receiver-c/             # 下游 C 配置（端口 5003）
        ├── app.json            # tsign key 与 dispatcher→C 的 encryptKey 一致
        └── ...

```

```
上游 (encryptKey=AAA...) → Dispatcher 解密
                         → 用 B 的 key (BBB...) 重新加密 → Receiver-B 解密
                         → 用 C 的 key (CCC...) 重新加密 → Receiver-C 解密

```

# 测试环境调试指南

## 前置：构建镜像

在项目根目录执行：

```bash
# 构建后端镜像
docker build -t tsign-dispatcher-backend -f docker/Dockerfile.backend .

# 构建前端镜像
docker build -t tsign-dispatcher-frontend -f docker/Dockerfile.frontend .
```

## 创建网络

```bash
docker network create test-net
```

## 单独启动各服务

### 1. Dispatcher (A) — 分发服务，端口 5001

```bash
docker run --rm \
  --name test-dispatcher \
  -p 5001:3001 \
  -v $(pwd)/config/dispatcher:/app/config \
  -v $(pwd)/logs/dispatcher:/app/logs \
  -e NODE_ENV=test \
  -e LOG_LEVEL=debug \
  --health-cmd="wget -q --spider http://localhost:3001/api/health" \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=10 \
  --health-start-period=10s \
  tsign-test-dispatcher:latest
```

### 2. Receiver-B — 下游接收者，端口 5002

```bash
docker run --rm \
  --name test-receiver-b \
  -p 5002:3001 \
  -v $(pwd)/docker/test/config/receiver-b:/app/config \
  -v $(pwd)/docker/test/logs/receiver-b:/app/logs \
  -e NODE_ENV=test \
  -e LOG_LEVEL=debug \
  --health-cmd="wget -q --spider http://localhost:3001/api/health" \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=10 \
  --health-start-period=10s \
  tsign-test-dispatcher:latest
```

### 3. Receiver-C — 下游接收者，端口 5003

```bash
docker run --rm \
  --name test-receiver-c \
  -p 5003:3001 \
  -v $(pwd)/docker/test/config/receiver-c:/app/config \
  -v $(pwd)/docker/test/logs/receiver-c:/app/logs \
  -e NODE_ENV=test \
  -e LOG_LEVEL=debug \
  --health-cmd="wget -q --spider http://localhost:3001/api/health" \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=10 \
  --health-start-period=10s \
  tsign-test-dispatcher:latest
```

### 4. Frontend — 管理前端，端口 5080

> 依赖 dispatcher 已启动

```bash
docker run --rm \
  --name test-frontend \
  -p 5080:80 \
  -v $(pwd)/docker/test/nginx.test.conf:/etc/nginx/conf.d/default.conf:ro \
  tsign-test-dispatcher:latest
```

## 快捷操作

```bash
# 后台启动全部（使用 docker compose）
cd docker/test && docker compose -f docker-compose.test.yml up -d --build

# 查看日志
docker logs -f test-dispatcher
docker logs -f test-receiver-b
docker logs -f test-receiver-c
docker logs -f test-frontend

# 停止并清理
cd docker/test && docker compose -f docker-compose.test.yml down

# 清理网络（单独启动时）
docker network rm test-net
```
