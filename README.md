# 腾讯电子签回调分发服务 (TSign Callback Dispatcher)

接收腾讯电子签的加密回调通知，解密后根据配置规则（事件类型、标签过滤等）分发到多个下游服务，支持二次加密转发。

## 架构

```
腾讯电子签
    │
    ▼ (加密回调)
┌──────────────────┐
│   Dispatcher     │  ← 解密 → 按规则分发 → 二次加密
│   (后端 :3001)    │
└──────┬───────────┘
       │
       ├──→ 下游服务 A (重新加密转发)
       ├──→ 下游服务 B
       └──→ 下游服务 C ...
```

管理前端提供可视化配置界面，支持回调管理、标签管理、系统设置。

## 项目结构

```
├── backend/             # 后端服务 (Express + TypeScript)
│   └── src/
│       ├── controllers/ # 路由控制器
│       ├── services/    # 业务逻辑 (分发、配置、标签匹配等)
│       ├── middleware/   # 中间件 (日志、验证)
│       ├── types/       # 类型定义
│       └── app.ts       # 入口
├── frontend/            # 管理前端 (React + Vite + TDesign)
│   └── src/
│       ├── pages/       # 页面 (回调管理、标签管理、系统设置)
│       └── components/  # 通用组件
├── config/              # 运行时配置 (JSON)
│   ├── app.json         # 应用配置 (端口、密钥、分发参数)
│   ├── callbacks.json   # 回调分发规则
│   └── tags.json        # 标签定义
├── docker/              # Docker 部署
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── test/            # Docker 测试环境
├── k8s/                 # Kubernetes 部署清单
├── dev.sh               # 本地开发脚本
└── package.json
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
npm run install:all
```

### 本地开发 (dev.sh)

项目根目录提供了 `dev.sh` 脚本，用于一键管理本地前后端服务：

```bash
# 启动所有服务（后台运行）
./dev.sh start

# 仅启动后端 / 前端
./dev.sh start backend
./dev.sh start frontend

# 停止所有服务
./dev.sh stop

# 仅停止后端 / 前端
./dev.sh stop backend
./dev.sh stop frontend

# 重启
./dev.sh restart
./dev.sh restart backend

# 查看运行状态
./dev.sh status

# 查看日志（跟随模式）
./dev.sh logs            # 后端日志
./dev.sh logs frontend   # 前端日志
```

也可通过 npm scripts 调用：

```bash
npm run dev              # 启动所有
npm run dev:stop         # 停止所有
npm run dev:restart      # 重启所有
npm run dev:status       # 查看状态
npm run dev:logs         # 后端日志
npm run dev:logs:frontend # 前端日志
```

启动后访问：

| 服务 | 地址 |
|------|------|
| 后端 API | http://localhost:3001 |
| 前端页面 | http://localhost:3000 |

> PID 文件保存在 `.dev-pids/`，日志输出到 `logs/dev/`。首次启动会自动安装缺失的 `node_modules`。

### 手动启动（前台）

如果需要前台运行查看实时输出，也可以分别在两个终端执行：

```bash
# 终端 1 - 后端
npm run dev:backend

# 终端 2 - 前端
npm run dev:frontend
```

## 配置说明

所有运行时配置位于 `config/` 目录，JSON 格式，支持热重载。

### app.json

```json
{
  "server": { "port": 3001, "host": "0.0.0.0" },
  "tsign": {
    "encryptKey": "腾讯电子签提供的消息加密密钥",
    "token": "签名验证令牌"
  },
  "dispatch": {
    "defaultTimeout": 10000,
    "defaultRetryCount": 3,
    "retryDelay": 1000
  },
  "log": { "level": "info", "maxFiles": 30 }
}
```

### callbacks.json

定义下游分发规则，每条规则包含：
- 目标 URL、超时、重试次数
- 事件类型过滤 (`msgTypes`，空数组表示全部)
- 标签过滤 (`tags`)
- 二次加密配置 (`reEncrypt` / `encryptKey` / `signToken`)
- 未知事件策略 (`unknownMsgTypePolicy`: `dispatch` / `drop` / `log`)

### tags.json

标签定义，系统内置两个标签：
- **FlowType** (合同类型) — 从回调消息的 `MsgData.FlowType` 字段匹配
- **UserData** (自定义数据) — 从回调消息的 `MsgData.UserData` 字段匹配

可用于按合同类型或自定义业务数据将回调分发到不同下游。

## Docker 部署

### 生产部署

```bash
cd docker
docker compose up -d --build
```

- 后端: `3001` 端口
- 前端: `80` 端口 (Nginx 反代后端 API)

### Docker 测试环境

`docker/test/` 提供完整的多服务测试环境（1 个 Dispatcher + 2 个 Receiver + 前端）：

```bash
# 启动测试环境
npm run test:docker:up

# 发送测试回调
npm run test:docker:send -- message.json

# 查看下游收到的回调
npm run test:docker:check

# 查看服务状态 / 日志
npm run test:docker:status
npm run test:docker:logs

# 停止 / 清理
npm run test:docker:down
npm run test:docker:clean
```

详见 `docker/test/test-env.sh --help`。

## Kubernetes 部署

K8s 清单位于 `k8s/` 目录：

```bash
kubectl apply -f k8s/
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/callback` | 接收腾讯电子签回调（加密消息） |
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/callbacks` | 获取回调配置列表 |
| POST | `/api/callbacks` | 新增回调配置 |
| PUT  | `/api/callbacks/:id` | 更新回调配置 |
| DELETE | `/api/callbacks/:id` | 删除回调配置 |
| GET  | `/api/tags` | 获取标签列表 |
| POST | `/api/tags` | 新增标签 |
| PUT  | `/api/tags/:id` | 更新标签 |
| DELETE | `/api/tags/:id` | 删除标签 |
| GET  | `/api/settings` | 获取系统设置 |
| PUT  | `/api/settings` | 更新系统设置 |

## 性能测试

基于 **K6** 压测 + **InfluxDB** 指标存储 + **Grafana** 可视化的性能测试方案，位于 `docker/test/` 目录。

### 架构

```
K6 (本地) ──POST──→ Dispatcher (Docker:5001) ──分发──→ Receiver-B/C (Docker:5002/5003)
    │
    └──指标──→ InfluxDB (Docker:8086) ──查询──→ Grafana (Docker:3030)
```

### 文件结构

```
docker/test/
├── docker-compose.perf.yml          # 性能测试 compose (Dispatcher + InfluxDB + Grafana)
├── perf-test.sh                     # 一键管理脚本
└── k6/
    ├── scripts/
    │   ├── load-test.js             # K6 明文模式压测脚本
    │   └── encrypt-load-test.js     # K6 加密模式压测脚本 (使用预生成数据)
    └── grafana/
        ├── dashboards/
        │   └── k6-dashboard.json    # 预配置 Grafana 面板
        └── provisioning/
            ├── datasources/influxdb.yml
            └── dashboards/dashboard.yml
```

### 前置条件

- Docker & Docker Compose
- [K6](https://k6.io/) (`brew install k6` 或 `perf-test.sh` 自动提示安装)

### 使用方式

```bash
cd docker/test

# 1. 启动性能测试基础设施 (Dispatcher + InfluxDB + Grafana)
./perf-test.sh up

# 2. 打开 Grafana 面板 (http://localhost:3030)
./perf-test.sh dash

# 3. 运行压测
./perf-test.sh run smoke             # 冒烟测试
./perf-test.sh run load              # 负载测试
./perf-test.sh run stress            # 压力测试
./perf-test.sh run soak              # 耐久测试

# 4. 加密模式 (先生成加密数据，再压测)
./perf-test.sh gen-data              # 生成加密消息数据
./perf-test.sh run-encrypted load    # 加密模式负载测试

# 5. 查看结果 / 关闭
./perf-test.sh report                # 查看结果汇总
./perf-test.sh down                  # 关闭所有服务
```

### 测试场景

| 场景 | VU 数 | 时长 | 用途 |
|------|-------|------|------|
| **smoke** | 1 | 30s | 验证通路正常 |
| **load** | 0→20→50 | 3.5min | 模拟正常高峰流量 |
| **stress** | 0→200 | 5min | 极限压力测试 |
| **soak** | 30 | 10min | 内存泄漏检测 |

### Grafana 面板指标

- **总览**: 平均/P95/P99 响应时间、错误率、RPS、活跃 VU
- **实时趋势**: 响应时间分布曲线、VU 变化、RPS 吞吐量、数据传输速率
- **详细指标**: 请求阶段耗时 (连接/TLS/发送/等待/接收)、自定义分发成功率

> Grafana 默认地址 `http://localhost:3030`，无需登录（匿名访问已开启），K6 Dashboard 已自动预配置。

### 测试结果 

测试场景
```
     scenarios: (100.00%) 1 scenario, 30 max VUs, 10m30s max duration (incl. graceful stop):
              * default: 30 looping VUs for 10m0s (gracefulStop: 30s)

INFO[0000] === K6 Performance Test ===                   source=console
INFO[0000] Target: http://localhost:5001/api/callback    source=console
INFO[0000] Scenario: soak                                source=console
INFO[0000] Encrypt: enabled                              source=console
INFO[0000] Token: disabled                               source=console
INFO[0000] Message templates: 6                          source=console

running (09m24.6s), 30/30 VUs, 322822 complete and 0 interrupted iterations
default   [==================================>---] 30 VUs  09m24.6s/10m0s
```

资源消耗
```
501625f45f44   perf-grafana       0.02%     70.79MiB / 5.786GiB   1.19%     25.6MB / 89.2MB   0B / 22.9MB      12
1678e6ab6379   perf-receiver-c    0.01%     18.47MiB / 5.786GiB   0.31%     2.46kB / 126B     0B / 0B          11
c4b38b4781eb   perf-dispatcher    32.34%    62.9MiB / 5.786GiB    1.06%     348MB / 371MB     0B / 48.7MB      11
4213feacd00e   perf-receiver-b    13.25%    55.21MiB / 5.786GiB   0.93%     224MB / 98MB      0B / 0B          11
3c366f78a09a   perf-influxdb      4.95%     52.96MiB / 5.786GiB   0.89%     988MB / 17.8MB    0B / 112MB       11
```


## 技术栈

- **后端**: Express + TypeScript + Winston (日志) + Axios (HTTP 转发)
- **前端**: React 18 + Vite + TDesign + Tailwind CSS + Recharts
- **测试**: K6 (压测) + InfluxDB (指标存储) + Grafana (可视化)
- **部署**: Docker / Docker Compose / Kubernetes

