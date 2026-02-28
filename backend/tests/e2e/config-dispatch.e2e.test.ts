import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import axios from 'axios';
import { createMockReceiver, MockReceiver } from '../helpers/mock-receiver';
import {
  createTempConfigDir,
  startDispatcher,
  stopDispatcher,
  cleanupDir,
  sendCallback,
  waitMs,
  DispatcherInstance,
} from '../helpers/test-utils';
import { buildEncryptedCallback, buildMockMessage } from '../helpers/crypto-helpers';
import { generateEncryptKey, generateSignToken } from '../../src/utils/crypto.util';

const DISPATCHER_PORT = 4001;
const RECEIVER_PORT = 4002;

const ENCRYPT_KEY = generateEncryptKey();
const TOKEN = generateSignToken();

let dispatcher: DispatcherInstance;
let receiver: MockReceiver;
let configDir: string;

describe('E2E: 配置变更生效验证', () => {
  beforeAll(async () => {
    configDir = createTempConfigDir({
      port: DISPATCHER_PORT,
      encryptKey: ENCRYPT_KEY,
      token: TOKEN,
      callbacks: [],
    });

    receiver = createMockReceiver(RECEIVER_PORT);
    await receiver.start();

    dispatcher = await startDispatcher(
      { port: DISPATCHER_PORT, encryptKey: ENCRYPT_KEY, token: TOKEN },
      configDir
    );
  }, 30000);

  afterAll(async () => {
    await stopDispatcher(dispatcher);
    await receiver.stop();
    cleanupDir(configDir);
  }, 15000);

  afterEach(async () => {
    receiver.clearReceived();
    // Clean up all callbacks to isolate tests
    const res = await axios.get(`${dispatcher.apiBase}/callbacks`);
    const allCallbacks = res.data?.data || [];
    for (const cb of allCallbacks) {
      await axios.delete(`${dispatcher.apiBase}/callbacks/${cb.id}`).catch(() => {});
    }
  });

  async function createCallbackConfig(overrides: Record<string, any> = {}) {
    const res = await axios.post(`${dispatcher.apiBase}/callbacks`, {
      name: `test-${Date.now()}`,
      url: `${receiver.url}/callback`,
      appType: 'company',
      tags: [],
      matchRules: [],
      enabled: true,
      retryCount: 0,
      timeout: 5000,
      msgTypes: [],
      unknownMsgTypePolicy: 'dispatch',
      ...overrides,
    });
    return res.data.data;
  }

  function sendTestCallback(msgType = 'FlowStatusChange') {
    const msg = buildMockMessage(msgType);
    const req = buildEncryptedCallback(msg, ENCRYPT_KEY, TOKEN);
    return sendCallback(DISPATCHER_PORT, req.body, req.query);
  }

  it('1. 新增配置后，回调消息被分发到目标地址', async () => {
    await createCallbackConfig();

    await sendTestCallback();
    const received = await receiver.waitForRequests(1, 5000);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const body = received[0].body;
    expect(body.MsgType || body.encrypt).toBeDefined();
  });

  it('2. 禁用配置后，不再分发', async () => {
    const config = await createCallbackConfig();

    await axios.put(`${dispatcher.apiBase}/callbacks/${config.id}`, { enabled: false });
    await waitMs(300);

    await sendTestCallback();
    await waitMs(1000);

    expect(receiver.getReceived().length).toBe(0);
  });

  it('3. 重新启用配置后，恢复分发', async () => {
    const config = await createCallbackConfig({ enabled: false });

    await sendTestCallback();
    await waitMs(500);
    expect(receiver.getReceived().length).toBe(0);

    await axios.put(`${dispatcher.apiBase}/callbacks/${config.id}`, { enabled: true });
    await waitMs(300);

    await sendTestCallback();
    const received = await receiver.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('4. msgTypes 过滤：只分发选中的事件', async () => {
    await createCallbackConfig({ msgTypes: ['FlowStatusChange'] });

    // 发不匹配的事件
    const msg1 = buildMockMessage('FlowCost');
    const req1 = buildEncryptedCallback(msg1, ENCRYPT_KEY, TOKEN);
    await sendCallback(DISPATCHER_PORT, req1.body, req1.query);
    await waitMs(1000);
    expect(receiver.getReceived().length).toBe(0);

    // 发匹配的事件
    const msg2 = buildMockMessage('FlowStatusChange');
    const req2 = buildEncryptedCallback(msg2, ENCRYPT_KEY, TOKEN);
    await sendCallback(DISPATCHER_PORT, req2.body, req2.query);
    const received = await receiver.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('5. unknownMsgTypePolicy: dispatch 放行 / discard 丢弃未知事件', async () => {
    const config = await createCallbackConfig({
      msgTypes: ['FlowStatusChange'],
      unknownMsgTypePolicy: 'dispatch',
    });

    // dispatch 模式：未知事件应被分发
    const msg1 = buildMockMessage('SomeNewUnknownEvent2099');
    const req1 = buildEncryptedCallback(msg1, ENCRYPT_KEY, TOKEN);
    await sendCallback(DISPATCHER_PORT, req1.body, req1.query);
    let received = await receiver.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiver.clearReceived();

    // 切换为 discard 模式
    await axios.put(`${dispatcher.apiBase}/callbacks/${config.id}`, {
      unknownMsgTypePolicy: 'discard',
    });
    await waitMs(300);

    const msg2 = buildMockMessage('AnotherUnknownEvent2099');
    const req2 = buildEncryptedCallback(msg2, ENCRYPT_KEY, TOKEN);
    await sendCallback(DISPATCHER_PORT, req2.body, req2.query);
    await waitMs(1000);
    expect(receiver.getReceived().length).toBe(0);
  });

  it('6. 删除配置后，不再分发', async () => {
    const config = await createCallbackConfig();

    await sendTestCallback();
    await receiver.waitForRequests(1, 5000);
    expect(receiver.getReceived().length).toBeGreaterThanOrEqual(1);

    receiver.clearReceived();

    await axios.delete(`${dispatcher.apiBase}/callbacks/${config.id}`);
    await waitMs(300);

    await sendTestCallback();
    await waitMs(1000);
    expect(receiver.getReceived().length).toBe(0);
  });
});
