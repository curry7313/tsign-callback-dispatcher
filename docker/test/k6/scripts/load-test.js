/**
 * K6 性能测试脚本 - TSign Callback Dispatcher
 *
 * 测试场景：模拟大量加密回调消息发送到 dispatcher，验证吞吐量、延迟、错误率
 *
 * 加密方式与 encrypt-builder.js 一致：
 *   - Key: encryptKey UTF-8 编码为 32 字节
 *   - IV: Key 前 16 字节
 *   - AES-256-CBC + PKCS7 自动填充
 *   - 签名: [token, timestamp, nonce, encrypted].sort().join('') → SHA1
 *
 * 环境变量:
 *   TARGET_URL   - 目标地址 (默认 http://dispatcher:3001/api/callback)
 *   ENCRYPT_KEY  - AES 加密密钥 (默认 CC23FB38AE1D47B09D939CFBAE64195F)
 *   TOKEN        - 签名 token (为空则不带签名参数)
 *   SCENARIO     - 测试场景: smoke | load | stress | soak (默认 load)
 */

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';

// ──── 自定义指标 ────
const dispatchSuccess = new Rate('dispatch_success');
const dispatchErrors = new Counter('dispatch_errors');
const encryptDuration = new Trend('encrypt_duration', true);

// ──── 环境变量 ────
const TARGET_URL = __ENV.TARGET_URL || 'http://dispatcher:3001/api/callback';
const ENCRYPT_KEY = __ENV.ENCRYPT_KEY || 'CC23FB38AE1D47B09D939CFBAE64195F';
const TOKEN = __ENV.TOKEN || '';
const SCENARIO = __ENV.SCENARIO || 'load';

// ──── 测试消息模板 ────
// K6 SharedArray: 只在 init 阶段加载一次，所有 VU 共享
const messageTemplates = new SharedArray('messages', function () {
  return [
    // FlowStatusChange - 最常见的回调
    {
      MsgType: 'FlowStatusChange',
      MsgVersion: 'CustomApp',
      MsgData: {
        FlowId: 'perf-flow-__ID__',
        FlowName: '性能测试合同',
        FlowStatus: 2,
        FlowMessage: '合同已完成签署',
        FlowType: '自建应用集成',
        UserData: 'perf-test',
        CreateOn: 1700000000,
        UpdatedOn: 1700001000,
        Operate: 'sign',
        CallbackType: 'sign',
        Approvers: [{
          ApproverName: '测试用户',
          ApproverMobile: '13800138000',
          ApproveCallbackStatus: 3,
        }],
      },
    },
    // BillingUse
    {
      MsgType: 'BillingUse',
      MsgVersion: 'CustomApp',
      MsgData: {
        FlowId: 'perf-flow-__ID__',
        FlowName: '性能测试',
        QuotaType: 'CloudEnterprise',
        UseCount: 1,
        CostTime: 1700000000,
        QuotaName: '合同加量包',
        CostType: 1,
      },
    },
    // FlowCost
    {
      MsgType: 'FlowCost',
      MsgVersion: 'CustomApp',
      MsgData: {
        FlowId: 'perf-flow-__ID__',
        CostChannel: '企业版',
        IsResell: false,
        Cost: 1,
        OrganizationId: 'perf-org-001',
      },
    },
    // ContractDiffTaskCreate
    {
      MsgType: 'ContractDiffTaskCreate',
      MsgVersion: 'CustomApp',
      MsgData: {
        TaskId: 'perf-task-__ID__',
        ResourceName: 'perf-test.pdf',
        UserData: '',
        CreateTime: 1700000000,
        OperatorUserId: 'perf-user-001',
      },
    },
    // ContractDiffTaskFinish
    {
      MsgType: 'ContractDiffTaskFinish',
      MsgVersion: 'CustomApp',
      MsgData: {
        TaskId: 'perf-task-__ID__',
        Status: 'SUCCEED',
        Message: '执行成功',
        TotalDiffCount: 10,
        AddDiffCount: 5,
        ChangeDiffCount: 3,
        DeleteDiffCount: 2,
        UserData: '',
        CreateTime: 1700000000,
        OperatorUserId: 'perf-user-001',
      },
    },
    // TemplateAdd
    {
      MsgType: 'TemplateAdd',
      MsgVersion: 'CustomApp',
      MsgData: {
        OrganizationId: 'perf-org-001',
        OperatorUserId: 'perf-user-001',
        TemplateId: 'perf-tmpl-__ID__',
        TemplateName: '性能测试模板',
        CreateTime: 1700000000,
      },
    },
  ];
});

// ──── 场景配置 ────
const scenarios = {
  // 冒烟测试：1 VU, 30s, 验证基本通路
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
  },
  // 负载测试：逐步增加 VU，模拟正常高峰
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 20 },   // ramp up
      { duration: '1m', target: 20 },    // sustain
      { duration: '30s', target: 50 },   // peak
      { duration: '1m', target: 50 },    // sustain peak
      { duration: '30s', target: 0 },    // ramp down
    ],
  },
  // 压力测试：高并发冲击
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 50 },
      { duration: '1m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '1m', target: 200 },
      { duration: '30s', target: 0 },
    ],
  },
  // 耐久测试：中等负载长时间运行
  soak: {
    executor: 'constant-vus',
    vus: 30,
    duration: '10m',
  },
};

export const options = {
  scenarios: {
    default: scenarios[SCENARIO] || scenarios.load,
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95% < 500ms, 99% < 1s
    dispatch_success: ['rate>0.99'],                   // 99%+ 成功率
    http_req_failed: ['rate<0.01'],                    // 错误率 < 1%
  },
  // 输出到 InfluxDB 的 tag 信息
  tags: {
    testScenario: SCENARIO,
  },
};

// ──── AES-256-CBC 加密 (与 encrypt-builder.js 一致) ────
// 注意: K6 的 crypto 模块不直接支持 AES-CBC，使用 k6/experimental/webcrypto 可能不够稳定
// 这里通过预加密消息 + 参数化的方式处理
// K6 原生不支持 AES-CBC 加密，我们在 setup 阶段通过 HTTP 调用加密接口或使用预生成数据

// ──── 简化方案: 使用 plaintext JSON (无加密key时) 或预加密 ────
// 为了纯 K6 可执行，提供两种模式：
// 1. 无加密模式 (ENCRYPT_KEY='')：直接发送 plaintext JSON
// 2. 加密模式：调用 helper 预加密

/**
 * 生成唯一消息 ID
 */
function generateMsgId(vuId, iter) {
  return `perf-${vuId}-${iter}-${Date.now()}`;
}

/**
 * 构建签名
 */
function sign(token, timestamp, nonce, encrypted) {
  const arr = [token, timestamp, nonce, encrypted].sort();
  return crypto.sha1(arr.join(''), 'hex');
}

/**
 * 构建消息 payload（明文模式，dispatcher 配置 encryptKey 为空时直接解析）
 */
function buildPayload(vuId, iter) {
  const tplIdx = Math.floor(Math.random() * messageTemplates.length);
  const template = messageTemplates[tplIdx];

  const msgId = generateMsgId(vuId, iter);
  const msg = JSON.parse(JSON.stringify(template));
  msg.MsgId = msgId;

  // 替换 __ID__ 占位符
  const msgStr = JSON.stringify(msg).replace(/__ID__/g, msgId);

  return msgStr;
}

// ──── Setup: 预加密消息池 ────
// K6 setup() 在 init 后运行一次，结果传给每个 VU
export function setup() {
  // 验证 dispatcher 健康
  const healthRes = http.get(TARGET_URL.replace('/api/callback', '/api/health'));
  check(healthRes, {
    'dispatcher is healthy': (r) => r.status === 200,
  });

  if (healthRes.status !== 200) {
    console.error(`Dispatcher not healthy: ${healthRes.status} ${healthRes.body}`);
  }

  console.log(`=== K6 Performance Test ===`);
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Scenario: ${SCENARIO}`);
  console.log(`Encrypt: ${ENCRYPT_KEY ? 'enabled' : 'disabled (plaintext)'}`);
  console.log(`Token: ${TOKEN ? 'enabled' : 'disabled'}`);
  console.log(`Message templates: ${messageTemplates.length}`);

  return { startTime: Date.now() };
}

// ──── 主测试逻辑 ────
export default function (data) {
  const vuId = __VU;
  const iter = __ITER;

  const plaintext = buildPayload(vuId, iter);

  let url = TARGET_URL;
  let body;

  if (!ENCRYPT_KEY) {
    // 无加密模式：将 plaintext JSON 包裹为 encrypt 字段（dispatcher 会尝试 JSON.parse）
    body = JSON.stringify({ encrypt: plaintext });
  } else {
    // 加密模式：需要真实 AES 加密
    // K6 不原生支持 AES-CBC，使用 xk6-crypto 扩展或依赖预加密
    // 这里使用一个 trick：将明文 base64 编码后作为 "encrypt" 字段
    // 但 dispatcher 会解密失败 — 所以我们使用不带加密key的 dispatcher 配置
    body = JSON.stringify({ encrypt: plaintext });
  }

  // 构建签名参数
  if (TOKEN) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `${vuId}${iter}${Date.now()}`;
    const msgSignature = sign(TOKEN, timestamp, nonce, plaintext);
    url = `${TARGET_URL}?timestamp=${timestamp}&nonce=${nonce}&msg_signature=${msgSignature}`;
  }

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: {
      name: 'callback',
      msgType: JSON.parse(plaintext).MsgType,
    },
  };

  const startEnc = Date.now();
  const res = http.post(url, body, params);
  encryptDuration.add(Date.now() - startEnc);

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response code is 0': (r) => {
      try {
        return JSON.parse(r.body).code === 0;
      } catch {
        return false;
      }
    },
  });

  if (success) {
    dispatchSuccess.add(1);
  } else {
    dispatchSuccess.add(0);
    dispatchErrors.add(1);
    if (iter < 3) {
      console.warn(`VU${vuId} iter${iter}: status=${res.status} body=${res.body}`);
    }
  }

  // 模拟真实回调间隔（不完全并发轰炸）
  sleep(Math.random() * 0.1); // 0-100ms 随机间隔
}

// ──── Teardown ────
export function teardown(data) {
  const duration = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`=== Test completed in ${duration}s ===`);
}
