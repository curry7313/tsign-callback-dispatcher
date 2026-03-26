import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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

const DISPATCHER_PORT = 14051;
const RECEIVER_A_PORT = 14052;
const RECEIVER_B_PORT = 14053;

const ENCRYPT_KEY = generateEncryptKey();
const TOKEN = generateSignToken();

let dispatcher: DispatcherInstance;
let receiverA: MockReceiver;
let receiverB: MockReceiver;
let configDir: string;

describe('E2E: 内置标签 FlowType / UserData 过滤分发', () => {
  beforeAll(async () => {
    configDir = createTempConfigDir({
      port: DISPATCHER_PORT,
      encryptKey: ENCRYPT_KEY,
      token: TOKEN,
      callbacks: [],
    });

    receiverA = createMockReceiver(RECEIVER_A_PORT);
    receiverB = createMockReceiver(RECEIVER_B_PORT);
    await receiverA.start();
    await receiverB.start();

    dispatcher = await startDispatcher(
      { port: DISPATCHER_PORT, encryptKey: ENCRYPT_KEY, token: TOKEN },
      configDir
    );
  }, 60000);

  afterAll(async () => {
    await stopDispatcher(dispatcher);
    await receiverA.stop();
    await receiverB.stop();
    cleanupDir(configDir);
  }, 15000);

  afterEach(async () => {
    receiverA.clearReceived();
    receiverB.clearReceived();
    // 清理所有 callback 配置
    const res = await dispatcher.api.get('/callbacks');
    const allCallbacks = res.data?.data || [];
    for (const cb of allCallbacks) {
      await dispatcher.api.delete(`/callbacks/${cb.id}`).catch(() => {});
    }
  });

  // ---- 辅助函数 ----

  async function createCallbackConfig(receiverUrl: string, overrides: Record<string, any> = {}) {
    const res = await dispatcher.api.post('/callbacks', {
      name: `test-${Date.now()}`,
      url: `${receiverUrl}/callback`,
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

  function sendMsg(msgType: string, msgData: Record<string, any> = {}) {
    const msg = buildMockMessage(msgType, msgData);
    const req = buildEncryptedCallback(msg, ENCRYPT_KEY, TOKEN);
    return sendCallback(DISPATCHER_PORT, req.body, req.query);
  }

  // ---- 内置标签在启动时自动初始化 ----

  async function getTags(): Promise<any[]> {
    const res = await dispatcher.api.get('/tags');
    // API 返回 { code, message, data: [...tags] }
    return res.data?.data || [];
  }

  it('1. 服务启动后内置标签 FlowType 和 UserData 已存在', async () => {
    const tags = await getTags();

    const flowTypeTag = tags.find((t: any) => t.key === 'FlowType' && t.builtIn);
    const userDataTag = tags.find((t: any) => t.key === 'UserData' && t.builtIn);

    expect(flowTypeTag).toBeDefined();
    expect(flowTypeTag.fieldPath).toBe('MsgData.FlowType');

    expect(userDataTag).toBeDefined();
    expect(userDataTag.fieldPath).toBe('MsgData.UserData');
  });

  it('2. 内置标签不可删除', async () => {
    const tags = await getTags();
    const flowTypeTag = tags.find((t: any) => t.key === 'FlowType' && t.builtIn);

    expect(flowTypeTag).toBeDefined();

    // 尝试删除
    try {
      await dispatcher.api.delete(`/tags/${flowTypeTag.id}`);
      // 如果返回了成功但实际未删除，也算保护成功
      const after = await getTags();
      const stillExists = after.find((t: any) => t.key === 'FlowType' && t.builtIn);
      expect(stillExists).toBeDefined();
    } catch (err: any) {
      // 400/403/404 均可接受
      expect([400, 403, 404]).toContain(err.response?.status);
    }
  });

  // ---- FlowType 过滤 ----

  it('3. FlowType 标签过滤：只分发匹配的合同类型', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
    });

    // 发送匹配的消息
    await sendMsg('FlowStatusChange', { FlowType: 'purchase', FlowName: '采购合同' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('4. FlowType 标签过滤：不匹配的合同类型不分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
    });

    // 发送不匹配的合同
    await sendMsg('FlowStatusChange', { FlowType: 'hr-contract', FlowName: 'HR合同' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  it('5. FlowType 标签过滤：非合同回调（无 FlowType 字段）- 默认策略 dispatch → 仍然分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
    });

    // 发送印章回调（MsgData 中无 FlowType），默认 builtInTagMissPolicy='dispatch' → 放行
    await sendMsg('OperateSeal', { SealId: 'seal-001', SealName: '公章' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('5b. FlowType 标签过滤：非合同回调 + 策略 discard → 不分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
      builtInTagMissPolicy: 'discard',
    });

    // 发送印章回调（MsgData 中无 FlowType），策略 discard → 不分发
    await sendMsg('OperateSeal', { SealId: 'seal-001', SealName: '公章' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  // ---- UserData 过滤 ----

  it('6. UserData 标签过滤：匹配的自定义数据 → 分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'UserData', value: 'dept-finance' }],
    });

    await sendMsg('FlowStatusChange', { FlowType: 'sale', UserData: 'dept-finance' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('7. UserData 标签过滤：不匹配 → 不分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'UserData', value: 'dept-finance' }],
    });

    await sendMsg('FlowStatusChange', { FlowType: 'sale', UserData: 'dept-hr' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  // ---- 多下游不同标签分发 ----

  it('8. 多下游不同 FlowType：各自只收到匹配的消息', async () => {
    // receiverA 只收 purchase
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
    });
    // receiverB 只收 sale
    await createCallbackConfig(receiverB.url, {
      tags: [{ key: 'FlowType', value: 'sale' }],
    });

    // 发送 purchase 合同
    await sendMsg('FlowStatusChange', { FlowType: 'purchase', FlowName: '采购合同' });
    await waitMs(1500);

    expect(receiverA.getReceived().length).toBeGreaterThanOrEqual(1);
    expect(receiverB.getReceived().length).toBe(0);

    receiverA.clearReceived();

    // 发送 sale 合同
    await sendMsg('FlowStatusChange', { FlowType: 'sale', FlowName: '销售合同' });
    await waitMs(1500);

    expect(receiverA.getReceived().length).toBe(0);
    expect(receiverB.getReceived().length).toBeGreaterThanOrEqual(1);
  });

  // ---- FlowType + UserData 组合过滤 ----

  it('9. FlowType + UserData 组合：两者都匹配才分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [
        { key: 'FlowType', value: 'purchase' },
        { key: 'UserData', value: 'dept-finance' },
      ],
    });

    // 两者都匹配
    await sendMsg('FlowStatusChange', { FlowType: 'purchase', UserData: 'dept-finance' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // FlowType 匹配，UserData 不匹配
    await sendMsg('FlowStatusChange', { FlowType: 'purchase', UserData: 'dept-hr' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  // ---- 无标签的配置仍然接收所有消息 ----

  it('10. 无标签配置 vs 有标签配置（discard策略）：无标签接收全部，有标签 + discard 过滤无字段消息', async () => {
    // receiverA 无标签 → 接收所有
    await createCallbackConfig(receiverA.url, { tags: [] });
    // receiverB 有 FlowType 标签 + discard 策略 → 无字段时不分发
    await createCallbackConfig(receiverB.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
      builtInTagMissPolicy: 'discard',
    });

    // 发送印章回调
    await sendMsg('OperateSeal', { SealId: 'seal-001' });
    await waitMs(1500);

    // receiverA 收到（无过滤），receiverB 不收到（无 FlowType 字段 + discard）
    expect(receiverA.getReceived().length).toBeGreaterThanOrEqual(1);
    expect(receiverB.getReceived().length).toBe(0);

    receiverA.clearReceived();

    // 发送匹配的合同回调
    await sendMsg('FlowStatusChange', { FlowType: 'purchase' });
    await waitMs(1500);

    // 两者都收到
    expect(receiverA.getReceived().length).toBeGreaterThanOrEqual(1);
    expect(receiverB.getReceived().length).toBeGreaterThanOrEqual(1);
  });

  // ---- FlowType 空值（只要字段存在即可） ----

  it('11. FlowType 标签值为空 + discard 策略：有字段分发，无字段不分发', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: '' }],
      builtInTagMissPolicy: 'discard',
    });

    // 有 FlowType 字段的消息 → 分发
    await sendMsg('FlowStatusChange', { FlowType: 'any-type' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // 无 FlowType 字段 + discard → 不分发
    await sendMsg('OperateSeal', { SealId: 'seal-001' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  it('12. FlowType 标签值为空 + dispatch 策略：无字段也放行', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: '' }],
      builtInTagMissPolicy: 'dispatch',
    });

    // 无 FlowType 字段 + dispatch → 仍放行
    await sendMsg('OperateSeal', { SealId: 'seal-001' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });
});
