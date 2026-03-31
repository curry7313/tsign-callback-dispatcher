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

/**
 * E2E 测试：自定义标签（带点号字段路径）全链路
 *
 * 验证场景：
 * 1. 创建 key 为 "MsgData.FlowName" 等带点号的标签 → 后端接受
 * 2. 在回调配置中引用该标签 → 配置生效
 * 3. 发送回调消息 → 标签过滤正确生效
 */

const DISPATCHER_PORT = 14061;
const RECEIVER_A_PORT = 14062;
const RECEIVER_B_PORT = 14063;

const ENCRYPT_KEY = generateEncryptKey();
const TOKEN = generateSignToken();

let dispatcher: DispatcherInstance;
let receiverA: MockReceiver;
let receiverB: MockReceiver;
let configDir: string;

describe('E2E: 自定义标签字段路径（带点号）全链路', () => {
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
    // 清理所有自定义标签（保留内置的）
    const tagRes = await dispatcher.api.get('/tags');
    const allTags = tagRes.data?.data || [];
    for (const tag of allTags) {
      if (!tag.builtIn) {
        await dispatcher.api.delete(`/tags/${tag.id}`).catch(() => {});
      }
    }
    // 清理所有 callback 配置
    const cbRes = await dispatcher.api.get('/callbacks');
    const allCallbacks = cbRes.data?.data || [];
    for (const cb of allCallbacks) {
      await dispatcher.api.delete(`/callbacks/${cb.id}`).catch(() => {});
    }
  });

  // ---- 辅助函数 ----

  async function createTag(data: Record<string, any>) {
    const res = await dispatcher.api.post('/tags', data);
    return res.data.data;
  }

  async function getTags(): Promise<any[]> {
    const res = await dispatcher.api.get('/tags');
    return res.data?.data || [];
  }

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

  // ======== 第一部分：标签创建（带点号 key）========

  it('1. 成功创建 key 为 MsgData.FlowName 的标签', async () => {
    const tag = await createTag({
      name: '合同名称',
      key: 'MsgData.FlowName',
      type: 'text',
      color: '#38bdf8',
      description: '按合同名称过滤',
    });

    expect(tag).toBeDefined();
    expect(tag.key).toBe('MsgData.FlowName');
    expect(tag.name).toBe('合同名称');

    // 验证能通过 GET 查到
    const tags = await getTags();
    const found = tags.find((t: any) => t.key === 'MsgData.FlowName');
    expect(found).toBeDefined();
  });

  it('2. 成功创建 key 为 MsgData.Operate 的 select 类型标签', async () => {
    const tag = await createTag({
      name: '操作类型',
      key: 'MsgData.Operate',
      type: 'select',
      options: ['Sign', 'Reject', 'Cancel'],
      color: '#34d399',
      description: '按操作类型过滤',
    });

    expect(tag).toBeDefined();
    expect(tag.key).toBe('MsgData.Operate');
    expect(tag.type).toBe('select');
    expect(tag.options).toEqual(['Sign', 'Reject', 'Cancel']);
  });

  it('3. 成功创建 key 为 MsgData.FlowCallbackStatus 的标签', async () => {
    const tag = await createTag({
      name: '合同状态',
      key: 'MsgData.FlowCallbackStatus',
      type: 'text',
      color: '#fbbf24',
    });

    expect(tag).toBeDefined();
    expect(tag.key).toBe('MsgData.FlowCallbackStatus');
  });

  it('4. 成功创建 key 为 MsgData.OrganizationId 的标签', async () => {
    const tag = await createTag({
      name: '组织ID',
      key: 'MsgData.OrganizationId',
      type: 'text',
      color: '#a78bfa',
    });

    expect(tag).toBeDefined();
    expect(tag.key).toBe('MsgData.OrganizationId');
  });

  it('5. 成功创建 key 为 MsgType 的标签（无点号，兼容性测试）', async () => {
    const tag = await createTag({
      name: '消息类型',
      key: 'MsgType',
      type: 'text',
      color: '#f87171',
    });

    expect(tag).toBeDefined();
    expect(tag.key).toBe('MsgType');
  });

  // ======== 第二部分：回调配置引用标签 ========

  it('6. 回调配置可以引用 MsgData.FlowName 标签进行过滤', async () => {
    // 先创建标签
    await createTag({
      name: '合同名称',
      key: 'MsgData.FlowName',
      type: 'text',
      color: '#38bdf8',
    });

    // 创建回调配置，使用 matchRules 引用该字段
    const config = await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配采购合同',
        field: 'MsgData.FlowName',
        operator: 'contains',
        value: '采购',
        tags: ['MsgData.FlowName'],
        enabled: true,
      }],
      tags: [{ key: 'MsgData.FlowName', value: '' }],
    });

    expect(config).toBeDefined();
    expect(config.matchRules).toHaveLength(1);
    expect(config.matchRules[0].field).toBe('MsgData.FlowName');
  });

  // ======== 第三部分：消息过滤生效 ========

  it('7. matchRule 基于 MsgData.FlowName 字段过滤：匹配的消息被分发', async () => {
    // 创建回调配置，使用 matchRules 匹配 FlowName 包含 "采购"
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配采购合同',
        field: 'MsgData.FlowName',
        operator: 'contains',
        value: '采购',
        tags: ['purchase_tag'],
        enabled: true,
      }],
    });

    // 发送匹配的消息
    await sendMsg('FlowStatusChange', { FlowName: '公司采购合同2026', FlowType: 'purchase' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('8. matchRule 基于 MsgData.FlowName 字段过滤：不匹配的消息不分发', async () => {
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配采购合同',
        field: 'MsgData.FlowName',
        operator: 'contains',
        value: '采购',
        tags: ['purchase_tag'],
        enabled: true,
      }],
    });

    // 发送不匹配的消息
    await sendMsg('FlowStatusChange', { FlowName: '人事入职合同', FlowType: 'hr' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  it('9. matchRule 基于 MsgData.Operate 字段精确匹配', async () => {
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配签署操作',
        field: 'MsgData.Operate',
        operator: 'exact',
        value: 'Sign',
        tags: ['sign_op'],
        enabled: true,
      }],
    });

    // 发送签署操作 → 应匹配
    await sendMsg('FlowStatusChange', { Operate: 'Sign', FlowName: '测试合同' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // 发送拒绝操作 → 不应匹配
    await sendMsg('FlowStatusChange', { Operate: 'Reject', FlowName: '测试合同' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  it('10. matchRule 基于 MsgData.OrganizationId 字段精确匹配', async () => {
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配特定组织',
        field: 'MsgData.OrganizationId',
        operator: 'exact',
        value: 'org-12345',
        tags: ['org_tag'],
        enabled: true,
      }],
    });

    // 匹配的组织 → 分发
    await sendMsg('FlowStatusChange', { OrganizationId: 'org-12345', FlowName: '合同' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // 不匹配的组织 → 不分发
    await sendMsg('FlowStatusChange', { OrganizationId: 'org-99999', FlowName: '合同' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  it('11. matchRule 基于 MsgData.FlowCallbackStatus 枚举匹配', async () => {
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配签署完成状态',
        field: 'MsgData.FlowCallbackStatus',
        operator: 'in',
        value: ['3', '7'],  // 3=签署完成, 7=撤销
        tags: ['completed_tag'],
        enabled: true,
      }],
    });

    // 状态 3 → 匹配
    await sendMsg('FlowStatusChange', { FlowCallbackStatus: 3, FlowName: '合同' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // 状态 1 → 不匹配
    await sendMsg('FlowStatusChange', { FlowCallbackStatus: 1, FlowName: '合同' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  // ======== 第四部分：多下游不同字段路径标签分发 ========

  it('12. 多下游配置使用不同字段路径标签：各自只收到匹配的消息', async () => {
    // receiverA 只匹配采购类合同名称
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-a-${Date.now()}`,
        name: '匹配采购合同',
        field: 'MsgData.FlowName',
        operator: 'contains',
        value: '采购',
        tags: ['purchase'],
        enabled: true,
      }],
    });

    // receiverB 只匹配签署完成操作
    await createCallbackConfig(receiverB.url, {
      matchRules: [{
        id: `rule-b-${Date.now()}`,
        name: '匹配签署操作',
        field: 'MsgData.Operate',
        operator: 'exact',
        value: 'Sign',
        tags: ['sign'],
        enabled: true,
      }],
    });

    // 发送采购合同 + Reject 操作 → 只有 receiverA 收到
    await sendMsg('FlowStatusChange', {
      FlowName: '年度采购合同',
      Operate: 'Reject',
      FlowType: 'purchase',
    });
    await waitMs(1500);

    expect(receiverA.getReceived().length).toBeGreaterThanOrEqual(1);
    expect(receiverB.getReceived().length).toBe(0);

    receiverA.clearReceived();

    // 发送 HR 合同 + Sign 操作 → 只有 receiverB 收到
    await sendMsg('FlowStatusChange', {
      FlowName: '人事入职合同',
      Operate: 'Sign',
      FlowType: 'hr',
    });
    await waitMs(1500);

    expect(receiverA.getReceived().length).toBe(0);
    expect(receiverB.getReceived().length).toBeGreaterThanOrEqual(1);
  });

  // ======== 第五部分：标签 + matchRules 组合使用 ========

  it('13. 内置标签 FlowType + matchRule MsgData.FlowName 组合过滤', async () => {
    await createCallbackConfig(receiverA.url, {
      tags: [{ key: 'FlowType', value: 'purchase' }],
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配采购合同名',
        field: 'MsgData.FlowName',
        operator: 'contains',
        value: '年度',
        tags: ['annual'],
        enabled: true,
      }],
    });

    // FlowType 匹配 + FlowName 匹配 → 分发
    await sendMsg('FlowStatusChange', {
      FlowType: 'purchase',
      FlowName: '年度采购合同',
    });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // FlowType 不匹配 → 不分发（内置标签先判断）
    await sendMsg('FlowStatusChange', {
      FlowType: 'hr',
      FlowName: '年度采购合同',
    });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);

    receiverA.clearReceived();

    // FlowType 匹配 + FlowName 不匹配 → 不分发（matchRule 不通过）
    await sendMsg('FlowStatusChange', {
      FlowType: 'purchase',
      FlowName: '日常销售合同',
    });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });

  // ======== 第六部分：标签 CRUD 然后引用验证 ========

  it('14. 创建标签 → 引用到回调配置 → 删除标签 → 标签仍可在配置中查到（配置保持）', async () => {
    // 创建标签
    const tag = await createTag({
      name: '合同名称',
      key: 'MsgData.FlowName',
      type: 'text',
      color: '#38bdf8',
    });

    // 创建引用该标签的回调配置
    const config = await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '匹配合同名',
        field: 'MsgData.FlowName',
        operator: 'exact',
        value: '测试合同',
        tags: ['MsgData.FlowName'],
        enabled: true,
      }],
    });

    expect(config.matchRules[0].field).toBe('MsgData.FlowName');

    // 删除标签
    await dispatcher.api.delete(`/tags/${tag.id}`);

    // 回调配置中的 matchRule 仍保留（配置不受标签删除影响）
    const configRes = await dispatcher.api.get(`/callbacks/${config.id}`);
    expect(configRes.data.data.matchRules[0].field).toBe('MsgData.FlowName');
  });

  it('15. MsgData.UserData 的 regex 匹配也能正常工作', async () => {
    await createCallbackConfig(receiverA.url, {
      matchRules: [{
        id: `rule-${Date.now()}`,
        name: '正则匹配 UserData',
        field: 'MsgData.UserData',
        operator: 'regex',
        value: '^dept-finance',
        tags: ['finance_dept'],
        enabled: true,
      }],
    });

    // 匹配 → 分发
    await sendMsg('FlowStatusChange', { UserData: 'dept-finance-team-a', FlowType: 'purchase' });
    const received = await receiverA.waitForRequests(1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(1);

    receiverA.clearReceived();

    // 不匹配 → 不分发
    await sendMsg('FlowStatusChange', { UserData: 'dept-hr-team-b', FlowType: 'purchase' });
    await waitMs(1500);
    expect(receiverA.getReceived().length).toBe(0);
  });
});
