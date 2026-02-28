/**
 * K6 加密性能测试脚本 - 使用预生成的加密消息池
 *
 * 此脚本配合 perf-test.sh 的预加密流程使用：
 *   1. perf-test.sh 调用 encrypt-builder.js 预生成加密消息 → k6/data/encrypted-messages.json
 *   2. K6 从 JSON 文件加载预加密消息池
 *   3. VU 从池中随机选取消息发送
 *
 * 这样既保证了真实加密流程，又避免了 K6 不支持 AES-CBC 的问题
 */

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ──── 自定义指标 ────
const dispatchSuccess = new Rate('dispatch_success');
const dispatchErrors = new Counter('dispatch_errors');
const requestDuration = new Trend('request_duration', true);

// ──── 环境变量 ────
const TARGET_URL = __ENV.TARGET_URL || 'http://dispatcher:3001/api/callback';
const TOKEN = __ENV.TOKEN || '';
const SCENARIO = __ENV.SCENARIO || 'load';
const DATA_FILE = __ENV.DATA_FILE || '/data/encrypted-messages.json';

// ──── 预加密消息池 ────
const encryptedMessages = new SharedArray('encrypted', function () {
  try {
    const data = JSON.parse(open(DATA_FILE));
    return data;
  } catch (e) {
    console.error(`Failed to load encrypted messages from ${DATA_FILE}: ${e}`);
    // fallback: 生成空消息
    return [{ encrypt: '{}', preview: 'fallback' }];
  }
});

// ──── 场景配置 ────
const scenarios = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
  },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 20 },
      { duration: '1m', target: 20 },
      { duration: '30s', target: 50 },
      { duration: '1m', target: 50 },
      { duration: '30s', target: 0 },
    ],
  },
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
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    dispatch_success: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
  tags: {
    testScenario: SCENARIO,
    encrypted: 'true',
  },
};

/**
 * 构建签名
 */
function sign(token, timestamp, nonce, encrypted) {
  const arr = [token, timestamp, nonce, encrypted].sort();
  return crypto.sha1(arr.join(''), 'hex');
}

export function setup() {
  const healthRes = http.get(TARGET_URL.replace('/api/callback', '/api/health'));
  check(healthRes, {
    'dispatcher is healthy': (r) => r.status === 200,
  });

  console.log(`=== K6 Encrypted Performance Test ===`);
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Scenario: ${SCENARIO}`);
  console.log(`Token: ${TOKEN ? 'enabled' : 'disabled'}`);
  console.log(`Pre-encrypted messages: ${encryptedMessages.length}`);

  return { startTime: Date.now() };
}

export default function () {
  // 从预加密池随机选取
  const idx = Math.floor(Math.random() * encryptedMessages.length);
  const msg = encryptedMessages[idx];

  const body = JSON.stringify({ encrypt: msg.encrypt });
  let url = TARGET_URL;

  if (TOKEN) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `${__VU}${__ITER}${Date.now()}`;
    const msgSignature = sign(TOKEN, timestamp, nonce, msg.encrypt);
    url = `${TARGET_URL}?timestamp=${timestamp}&nonce=${nonce}&msg_signature=${msgSignature}`;
  }

  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'encrypted_callback' },
  };

  const start = Date.now();
  const res = http.post(url, body, params);
  requestDuration.add(Date.now() - start);

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
    if (__ITER < 3) {
      console.warn(`VU${__VU}: status=${res.status} body=${res.body}`);
    }
  }

  sleep(Math.random() * 0.1);
}

export function teardown(data) {
  const duration = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`=== Encrypted test completed in ${duration}s ===`);
}
