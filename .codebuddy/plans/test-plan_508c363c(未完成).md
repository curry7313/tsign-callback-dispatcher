---
name: test-plan
overview: 为 tsign-callback-dispatcher 制定测试计划，同时补充生产代码中缺失的"用下游 encryptKey/signToken 重新加密后分发"逻辑。E2E 测试验证配置变更后分发行为是否生效；集成测试启动 3 个实例（1 个分发器 + 2 个接收者），用人工构造的加密请求模拟完整链路。
todos:
  - id: fix-crypto-and-dispatch
    content: 补全生产功能：crypto.util.ts 新增 encryptAES256CBC 和 generateSignature，http.util.ts 扩展 params 支持，dispatch.service.ts 实现重新加密分发逻辑，app.config.ts 和 logger.service.ts 支持环境变量
    status: pending
  - id: add-received-callbacks-api
    content: callback.controller.ts 新增 receivedCallbacks 内存队列和查询 API，app.ts 注册 GET /api/received-callbacks 路由
    status: pending
    dependencies:
      - fix-crypto-and-dispatch
  - id: setup-test-infra
    content: 安装 vitest 到 backend devDependencies，创建 vitest.config.ts，package.json 新增 test/test:e2e/test:integration 脚本
    status: pending
    dependencies:
      - fix-crypto-and-dispatch
  - id: create-test-helpers
    content: 创建 tests/helpers 下三个辅助模块：mock-receiver.ts（轻量接收服务器）、test-utils.ts（临时配置/进程管理/健康检查）、crypto-helpers.ts（构造加密请求）
    status: pending
    dependencies:
      - setup-test-infra
      - add-received-callbacks-api
  - id: write-e2e-tests
    content: 编写 tests/e2e/config-dispatch.e2e.test.ts，覆盖配置新增/禁用/启用/msgTypes过滤/unknownMsgTypePolicy策略/删除共 6 个 E2E 用例
    status: pending
    dependencies:
      - create-test-helpers
  - id: write-integration-tests
    content: 编写 tests/integration/multi-instance.integration.test.ts，覆盖三实例全链路加密分发、选择性分发、事件过滤共 3 个集成用例
    status: pending
    dependencies:
      - create-test-helpers
  - id: run-and-verify
    content: 运行全部测试验证通过，使用 [mcp:playwright] 辅助验证前端页面配置联动效果
    status: pending
    dependencies:
      - write-e2e-tests
      - write-integration-tests
---

## 用户需求

为 tsign-callback-dispatcher 项目制定完整的测试计划并实现，包含两大维度：

## 核心功能

### 一、E2E 测试 -- 配置变更生效验证

通过 API 对回调配置进行 CRUD 操作后，发送模拟回调请求，验证配置变更是否实时生效。覆盖场景包括：

- 新增回调配置后，分发是否送达新目标
- 禁用/启用回调配置后，分发行为是否立即变化
- 修改 msgTypes 过滤列表后，事件过滤是否生效
- unknownMsgTypePolicy 策略切换（dispatch/discard）后，未知事件处理是否正确
- 删除回调配置后，该目标不再收到分发

### 二、集成测试 -- 多实例分发链路验证

在本地启动 3 个分发服务实例，模拟完整的加密回调分发链路：

- **实例 A（端口 5001）**：主分发器，接收上游加密回调，解密后用下游各自的 encryptKey/signToken 重新加密分发
- **实例 B（端口 5002）**：接收者 1，用自己的 encryptKey 解密验证
- **实例 C（端口 5003）**：接收者 2，用自己的 encryptKey 解密验证
- 测试脚本人工构造加密请求发送到 A，验证 B、C 都正确收到并能解密消息
- 验证选择性分发：A 只配置分发到 B 时，C 不应收到
- 验证事件类型过滤在多实例链路中的正确性

### 前置条件 -- 功能补全

测试计划实现前需补全缺失的生产功能：

- `crypto.util.ts` 新增 `encryptAES256CBC` 加密函数和 `generateSignature` 签名生成函数
- `dispatch.service.ts` 修改分发逻辑：当下游配置了 encryptKey/signToken 时，先重新加密再发送
- `http.util.ts` 扩展 `HttpPostOptions` 支持 query 参数（用于传递 timestamp/nonce/msg_signature）
- `app.config.ts` 支持 `CONFIG_DIR` 环境变量覆盖配置目录（多实例隔离）

## 技术栈

- **测试框架**：vitest（与项目 TypeScript + Node.js 栈契合，零配置支持 TS，速度快）
- **HTTP 请求**：axios（项目已有依赖）
- **运行时**：Node.js + TypeScript（ts-node-dev 复用开发启动方式）
- **断言**：vitest 内置 expect
- **进程管理**：Node.js `child_process.spawn`（集成测试中启动多个服务实例）

## 实现方案

### 整体策略

分为两个阶段：第一阶段补全生产功能（加密分发链路），第二阶段基于完整功能编写 E2E 和集成测试。

### 第一阶段：生产功能补全

#### 1. 加密函数（crypto.util.ts）

新增 `encryptAES256CBC`，为 `decryptAES256CBC` 的逆操作：

- 输入：明文 JSON 字符串 + encodingAESKey
- 处理：生成 16 字节随机前缀 + 4 字节消息长度（BigEndian）+ 消息内容 + PKCS#7 填充 → AES-256-CBC 加密 → Base64 编码
- 密钥派生：`Base64Decode(encodingAESKey + "=")` → 32 字节 AES key，IV = key 前 16 字节
- 约束：加密结果必须能被现有 `decryptAES256CBC` 正确解密（自测闭环）

新增 `generateSignature`：

- 输入：token, timestamp, nonce, encrypt
- 处理：`SHA1(sort([token, timestamp, nonce, encrypt]).join(''))`
- 与现有 `verifySignature` 逻辑一致，只是返回签名而非比较

#### 2. 分发逻辑重构（dispatch.service.ts）

修改 `dispatchMessage` 中分发到下游的逻辑：

- 检查 `callbackConfig.encryptKey` 是否存在
- **有 encryptKey**：

1. 将 `message` 序列化为 JSON 字符串
2. 调用 `encryptAES256CBC(jsonStr, callbackConfig.encryptKey)` 生成密文
3. 生成 timestamp（当前秒级时间戳）和 nonce（随机字符串）
4. 用 `callbackConfig.signToken` 调用 `generateSignature` 生成 msg_signature
5. 构造 body `{ encrypt: "密文" }` + query `{ timestamp, nonce, msg_signature }`

- **无 encryptKey**：保持现有明文 `data: message` 行为（向后兼容）

#### 3. HTTP 工具扩展（http.util.ts）

`HttpPostOptions` 新增可选字段 `params?: Record<string, string>`，传入 axios 的 `params` 配置项，用于附加 URL query 参数。

#### 4. 配置目录环境变量支持（app.config.ts）

将 `CONFIG_DIR` 改为 `process.env.CONFIG_DIR || path.resolve(__dirname, '../../../config')`，使多实例可通过环境变量指定独立配置目录。同时 `config.service.ts` 中的 `CONFIG_DIR` 引用通过 `getConfigDir()` 获取，已间接支持。`logger.service.ts` 的 `LOG_DIR` 也需支持环境变量。

### 第二阶段：测试实现

#### 1. 测试基础设施

- 安装 vitest 到 backend devDependencies
- 创建 `vitest.config.ts` 配置文件
- `backend/package.json` 新增 `"test"` 和 `"test:e2e"` 和 `"test:integration"` 脚本

#### 2. E2E 测试架构

```
tests/e2e/config-dispatch.e2e.test.ts
```

- 使用独立的临时 config 目录（每次测试前创建，测试后清理）
- 启动一个分发服务实例 A（端口 5001）+ 一个轻量 Mock Receiver 服务（端口 5099，记录收到的请求）
- 通过 API 操作 A 的配置 → 发送模拟回调到 A → 检查 Mock Receiver 是否收到/未收到分发

E2E 测试用例：

1. 新增配置 → 发送回调 → Mock Receiver 收到分发
2. 禁用配置 → 发送回调 → Mock Receiver 不再收到
3. 重新启用 → Mock Receiver 恢复收到
4. 修改 msgTypes 只含 FlowStatusChange → 发 FlowCost 事件 → 不分发；发 FlowStatusChange → 分发
5. unknownMsgTypePolicy=dispatch → 发未知类型 → 分发；改为 discard → 不分发
6. 删除配置 → 发送回调 → 不分发

#### 3. 集成测试架构

```
tests/integration/multi-instance.integration.test.ts
```

三实例部署：

- **实例 A（端口 5001）**：主分发器
- `app.json`: `tsign.encryptKey = keyA`, `tsign.token = tokenA`, `server.port = 5001`
- `callbacks.json`: 配置 B、C 为下游，每个有独立的 encryptKey/signToken
- **实例 B（端口 5002）**：接收者
- `app.json`: `tsign.encryptKey = keyB`, `tsign.token = tokenB`, `server.port = 5002`
- `callbacks.json`: 空（无下游）
- **实例 C（端口 5003）**：接收者
- `app.json`: `tsign.encryptKey = keyC`, `tsign.token = tokenC`, `server.port = 5003`
- `callbacks.json`: 空（无下游）

密钥关系：

- A 的 `callbacks.json` 中 B 的配置的 encryptKey/signToken = B 的 `app.json` 的 tsign.encryptKey/token
- A 的 `callbacks.json` 中 C 的配置的 encryptKey/signToken = C 的 `app.json` 的 tsign.encryptKey/token

测试流程：

1. 测试脚本用 keyA 加密一条 FlowStatusChange 消息 + 用 tokenA 签名 → POST 到 A 的 `/api/callback`
2. A 解密 → 匹配到 B、C → 分别用 keyB、keyC 重新加密 → POST 到 B、C
3. 验证 B、C 的分发日志（通过 `GET /api/logs`）中记录了该消息的成功接收
4. 选择性分发测试：只在 A 中配置 B 为下游（不配 C）→ 发回调 → B 收到、C 未收到

验证 B/C 收到消息的方式：

- **方案一（采用）**：B、C 作为完整分发服务实例，收到加密回调后走正常 handleCallback 流程，会记录日志到 `operation-logs.json`。但 B、C 没有下游配置，所以 dispatchMessage 不会产生分发日志。需要新增一个 **最近接收的回调查询 API**（`GET /api/received-callbacks`）用于测试断言。
- **实现方式**：在 `callback.controller.ts` 的 `handleCallback` 中维护一个内存队列记录最近解密成功的消息（最多保留 100 条），暴露 `GET /api/received-callbacks` API 供测试查询。

### 实现细节

#### 加密函数关键逻辑

```
encryptAES256CBC(plainText: string, encodingAESKey: string): string
  1. aesKey = Base64Decode(encodingAESKey + "=")   // 32 bytes
  2. iv = aesKey.subarray(0, 16)                    // 前16字节
  3. randomPrefix = crypto.randomBytes(16)           // 16字节随机前缀
  4. msgLenBuf = Buffer.alloc(4); msgLenBuf.writeUInt32BE(Buffer.byteLength(plainText))
  5. payload = concat(randomPrefix, msgLenBuf, Buffer.from(plainText))
  6. PKCS#7 padding to 32-byte block size
  7. cipher = AES-256-CBC(aesKey, iv, padded)
  8. return cipher.toString('base64')
```

#### 多实例启动方式

使用 `child_process.spawn` 启动 `ts-node-dev` 进程，每个进程通过环境变量 `CONFIG_DIR` 指向独立的临时配置目录。测试框架的 `beforeAll` 启动、`afterAll` 关闭和清理。

#### 性能考虑

- E2E 测试中 Mock Receiver 使用简单的 Express 服务器，内存记录请求，测试结束后关闭
- 多实例启动使用 `ts-node-dev --transpile-only` 跳过类型检查加速启动
- 每个测试套件之间清理临时目录和端口，避免资源泄漏
- 测试超时设置为 30 秒（考虑到多实例启动时间）

#### 爆炸半径控制

- 生产代码修改严格限定在 4 个文件（crypto.util.ts, dispatch.service.ts, http.util.ts, app.config.ts）
- `CONFIG_DIR` 环境变量为可选，不设置时行为完全不变
- dispatch 重新加密逻辑仅在 `callbackConfig.encryptKey` 存在时触发，否则保持原有明文行为
- 新增的 `received-callbacks` API 仅在内存中维护少量记录，不影响性能和磁盘 I/O

## 目录结构

```
backend/
├── src/
│   ├── utils/
│   │   ├── crypto.util.ts            # [MODIFY] 新增 encryptAES256CBC() 加密函数和 generateSignature() 签名生成函数。加密为解密的逆操作：16字节随机前缀 + 4字节消息长度 + 消息内容 + PKCS#7填充 → AES-256-CBC → Base64。签名函数复用已有 verifySignature 的 SHA1 逻辑。
│   │   └── http.util.ts              # [MODIFY] HttpPostOptions 新增可选 params?: Record<string, string> 字段，传入 axios config.params 作为 URL query 参数。
│   ├── config/
│   │   └── app.config.ts             # [MODIFY] CONFIG_DIR 改为优先读取 process.env.CONFIG_DIR 环境变量，回退到现有的 path.resolve 逻辑。支持多实例隔离配置。
│   ├── services/
│   │   ├── dispatch.service.ts       # [MODIFY] 分发前检查 callbackConfig.encryptKey：有则加密消息+生成签名+构造加密 body 和 query 参数；无则保持原有明文发送。
│   │   └── logger.service.ts         # [MODIFY] LOG_DIR 支持 process.env.LOG_DIR 环境变量覆盖。
│   ├── controllers/
│   │   └── callback.controller.ts    # [MODIFY] handleCallback 成功解密后将消息推入内存队列 receivedCallbacks（最多100条）；新增 getReceivedCallbacks 导出函数用于查询。
│   └── app.ts                        # [MODIFY] 注册 GET /api/received-callbacks 路由。
├── tests/
│   ├── helpers/
│   │   ├── mock-receiver.ts          # [NEW] 轻量 Express 服务器，监听指定端口，记录收到的所有 POST 请求到内存数组，提供 getRequests()/clear()/close() 方法。用于 E2E 测试中验证分发是否送达。
│   │   ├── test-utils.ts             # [NEW] 测试工具函数：createTempConfigDir（创建临时配置目录并写入指定的 app.json/callbacks.json）、startInstance（spawn 服务进程）、stopInstance、waitForReady（轮询 /api/health）、sendEncryptedCallback（构造加密请求发送到指定实例）、cleanup。
│   │   └── crypto-helpers.ts         # [NEW] 测试加密辅助函数：封装 encryptAES256CBC + generateSignature，提供 buildEncryptedRequest(message, encryptKey, token) 返回完整的 { body, query } 对象，方便测试脚本构造加密请求。
│   ├── e2e/
│   │   └── config-dispatch.e2e.test.ts  # [NEW] E2E 测试套件。测试配置 CRUD 后分发行为是否实时生效。6 个核心用例：新增配置→分发送达、禁用→停止分发、启用→恢复分发、msgTypes 过滤、unknownMsgTypePolicy 策略、删除→停止分发。
│   └── integration/
│       └── multi-instance.integration.test.ts  # [NEW] 集成测试套件。启动 A/B/C 三个分发服务实例，全链路加密分发验证。核心用例：全量分发到 B+C、选择性分发只到 B、事件类型过滤在多实例链路中的正确性。
├── vitest.config.ts                  # [NEW] vitest 配置文件。设置 test.include 指向 tests/**/*.test.ts，超时 30s，环境 node。
└── package.json                      # [MODIFY] devDependencies 新增 vitest；scripts 新增 "test"、"test:e2e"、"test:integration" 命令。
```

## 关键代码结构

```typescript
// crypto.util.ts 新增函数签名
export function encryptAES256CBC(plainText: string, encodingAESKey: string): string;
export function generateSignature(token: string, timestamp: string, nonce: string, encrypt: string): string;

// http.util.ts 扩展接口
export interface HttpPostOptions {
  url: string;
  data: any;
  headers?: Record<string, string>;
  params?: Record<string, string>;  // 新增：URL query 参数
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

// callback.controller.ts 新增导出
export function getReceivedCallbacks(req: Request, res: Response): void;
```

## Agent Extensions

### Skill

- **backend-patterns**
- 用途：指导后端加密分发链路的架构设计、API 设计模式、测试服务管理等后端最佳实践
- 预期结果：确保加密/解密闭环逻辑、多进程管理、临时配置隔离等实现符合 Node.js 后端工程最佳实践

### MCP

- **playwright**
- 用途：在 E2E 测试验证阶段，通过浏览器自动化操作前端页面验证配置变更的 UI 联动效果（如创建回调后表格列表更新、弹窗交互等）
- 预期结果：补充 API 层 E2E 测试之外的前端界面级验证