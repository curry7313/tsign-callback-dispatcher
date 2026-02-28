import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';
import {
  createTempConfigDir,
  startDispatcher,
  stopDispatcher,
  cleanupDir,
  sendCallback,
  getReceivedCallbacks,
  clearReceivedCallbacks,
  waitMs,
  DispatcherInstance,
} from '../helpers/test-utils';
import { buildEncryptedCallback, buildMockMessage } from '../helpers/crypto-helpers';
import { createMockReceiver, MockReceiver } from '../helpers/mock-receiver';
import { generateEncryptKey, generateSignToken } from '../../src/utils/crypto.util';

// Instance A: main dispatcher
const PORT_A = 5001;
const KEY_A = generateEncryptKey();
const TOKEN_A = generateSignToken();

// Instance B: receiver 1
const PORT_B = 5002;
const KEY_B = generateEncryptKey();
const TOKEN_B = generateSignToken();

// Instance C: receiver 2
const PORT_C = 5003;
const KEY_C = generateEncryptKey();
const TOKEN_C = generateSignToken();

// Mock receiver for plaintext test
const PORT_MOCK = 5004;

let instanceA: DispatcherInstance;
let instanceB: DispatcherInstance;
let instanceC: DispatcherInstance;
let mockReceiver: MockReceiver;
let configDirA: string;
let configDirB: string;
let configDirC: string;

describe('集成测试: 多实例分发链路', () => {
  beforeAll(async () => {
    // B and C configs: no downstream
    configDirB = createTempConfigDir({
      port: PORT_B,
      encryptKey: KEY_B,
      token: TOKEN_B,
      callbacks: [],
    });

    configDirC = createTempConfigDir({
      port: PORT_C,
      encryptKey: KEY_C,
      token: TOKEN_C,
      callbacks: [],
    });

    // A config: dispatches to B (reEncrypt=true) and C (reEncrypt=true)
    configDirA = createTempConfigDir({
      port: PORT_A,
      encryptKey: KEY_A,
      token: TOKEN_A,
      callbacks: [
        {
          id: 'cb-to-b',
          name: '分发到B',
          url: `http://localhost:${PORT_B}/api/callback`,
          appType: 'company',
          tags: [],
          matchRules: [],
          enabled: true,
          retryCount: 0,
          timeout: 5000,
          headers: {},
          msgTypes: [],
          unknownMsgTypePolicy: 'dispatch',
          encryptKey: KEY_B,
          signToken: TOKEN_B,
          reEncrypt: true,
          remark: 'test-to-B',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'cb-to-c',
          name: '分发到C',
          url: `http://localhost:${PORT_C}/api/callback`,
          appType: 'company',
          tags: [],
          matchRules: [],
          enabled: true,
          retryCount: 0,
          timeout: 5000,
          headers: {},
          msgTypes: [],
          unknownMsgTypePolicy: 'dispatch',
          encryptKey: KEY_C,
          signToken: TOKEN_C,
          reEncrypt: true,
          remark: 'test-to-C',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    // Start mock receiver for plaintext test
    mockReceiver = createMockReceiver(PORT_MOCK);
    await mockReceiver.start();

    // Start instances B and C first (they are receivers)
    [instanceB, instanceC] = await Promise.all([
      startDispatcher({ port: PORT_B, encryptKey: KEY_B, token: TOKEN_B }, configDirB),
      startDispatcher({ port: PORT_C, encryptKey: KEY_C, token: TOKEN_C }, configDirC),
    ]);

    // Then start instance A (it dispatches to B and C)
    instanceA = await startDispatcher({ port: PORT_A, encryptKey: KEY_A, token: TOKEN_A }, configDirA);
  }, 60000);

  afterAll(async () => {
    await Promise.all([
      stopDispatcher(instanceA),
      stopDispatcher(instanceB),
      stopDispatcher(instanceC),
      mockReceiver.stop(),
    ]);
    cleanupDir(configDirA);
    cleanupDir(configDirB);
    cleanupDir(configDirC);
  }, 15000);

  it('1. 回调消息加密分发到 B 和 C，两者均成功解密', async () => {
    await clearReceivedCallbacks(PORT_B);
    await clearReceivedCallbacks(PORT_C);

    const msg = buildMockMessage('FlowStatusChange', { FlowId: 'integration-test-1' });
    const req = buildEncryptedCallback(msg, KEY_A, TOKEN_A);
    await sendCallback(PORT_A, req.body, req.query);

    // Wait for async dispatch chain
    await waitMs(3000);

    const receivedB = await getReceivedCallbacks(PORT_B);
    const receivedC = await getReceivedCallbacks(PORT_C);

    expect(receivedB.length).toBeGreaterThanOrEqual(1);
    expect(receivedC.length).toBeGreaterThanOrEqual(1);

    // Verify message content was correctly decrypted
    expect(receivedB[0].message.MsgType).toBe('FlowStatusChange');
    expect(receivedB[0].message.MsgData.FlowId).toBe('integration-test-1');
    expect(receivedC[0].message.MsgType).toBe('FlowStatusChange');
    expect(receivedC[0].message.MsgData.FlowId).toBe('integration-test-1');
  });

  it('2. 禁用 B 后仅 C 收到消息', async () => {
    await clearReceivedCallbacks(PORT_B);
    await clearReceivedCallbacks(PORT_C);

    // Disable B in A's config
    await axios.put(`${instanceA.apiBase}/callbacks/cb-to-b`, { enabled: false });
    await waitMs(300);

    const msg = buildMockMessage('FlowStatusChange', { FlowId: 'integration-test-2' });
    const req = buildEncryptedCallback(msg, KEY_A, TOKEN_A);
    await sendCallback(PORT_A, req.body, req.query);

    await waitMs(3000);

    const receivedB = await getReceivedCallbacks(PORT_B);
    const receivedC = await getReceivedCallbacks(PORT_C);

    expect(receivedB.length).toBe(0);
    expect(receivedC.length).toBeGreaterThanOrEqual(1);
    expect(receivedC[0].message.MsgData.FlowId).toBe('integration-test-2');

    // Re-enable B for subsequent tests
    await axios.put(`${instanceA.apiBase}/callbacks/cb-to-b`, { enabled: true });
    await waitMs(300);
  });

  it('3. 事件类型过滤：B 只接收 FlowStatusChange，C 接收全部', async () => {
    await clearReceivedCallbacks(PORT_B);
    await clearReceivedCallbacks(PORT_C);

    // Set B to only accept FlowStatusChange
    await axios.put(`${instanceA.apiBase}/callbacks/cb-to-b`, {
      msgTypes: ['FlowStatusChange'],
    });
    await waitMs(300);

    // Send FlowCost event
    const msg1 = buildMockMessage('FlowCost', { FlowId: 'integration-test-3-cost' });
    const req1 = buildEncryptedCallback(msg1, KEY_A, TOKEN_A);
    await sendCallback(PORT_A, req1.body, req1.query);

    await waitMs(3000);

    let receivedB = await getReceivedCallbacks(PORT_B);
    let receivedC = await getReceivedCallbacks(PORT_C);

    expect(receivedB.length).toBe(0);
    expect(receivedC.length).toBeGreaterThanOrEqual(1);

    await clearReceivedCallbacks(PORT_B);
    await clearReceivedCallbacks(PORT_C);

    // Send FlowStatusChange event
    const msg2 = buildMockMessage('FlowStatusChange', { FlowId: 'integration-test-3-status' });
    const req2 = buildEncryptedCallback(msg2, KEY_A, TOKEN_A);
    await sendCallback(PORT_A, req2.body, req2.query);

    await waitMs(3000);

    receivedB = await getReceivedCallbacks(PORT_B);
    receivedC = await getReceivedCallbacks(PORT_C);

    expect(receivedB.length).toBeGreaterThanOrEqual(1);
    expect(receivedC.length).toBeGreaterThanOrEqual(1);
    expect(receivedB[0].message.MsgType).toBe('FlowStatusChange');

    // Reset B to accept all events
    await axios.put(`${instanceA.apiBase}/callbacks/cb-to-b`, { msgTypes: [] });
    await waitMs(300);
  });

  it('4. reEncrypt=false 时下游收到明文消息', async () => {
    mockReceiver.clearReceived();

    // Add a plaintext callback config to A pointing to mock receiver
    const createRes = await axios.post(`${instanceA.apiBase}/callbacks`, {
      name: '明文分发到MockReceiver',
      url: `${mockReceiver.url}/callback`,
      appType: 'company',
      tags: [],
      matchRules: [],
      enabled: true,
      retryCount: 0,
      timeout: 5000,
      msgTypes: [],
      unknownMsgTypePolicy: 'dispatch',
      encryptKey: '',
      signToken: '',
      reEncrypt: false,
      remark: 'plaintext-test',
    });
    const plainConfig = createRes.data.data;

    const msg = buildMockMessage('FlowStatusChange', { FlowId: 'plaintext-test' });
    const req = buildEncryptedCallback(msg, KEY_A, TOKEN_A);
    await sendCallback(PORT_A, req.body, req.query);

    const received = await mockReceiver.waitForRequests(1, 5000);

    expect(received.length).toBeGreaterThanOrEqual(1);
    // Plaintext: body should contain MsgType directly (not encrypt)
    expect(received[0].body.MsgType).toBe('FlowStatusChange');
    expect(received[0].body.MsgData.FlowId).toBe('plaintext-test');
    expect(received[0].body.encrypt).toBeUndefined();

    // Cleanup
    await axios.delete(`${instanceA.apiBase}/callbacks/${plainConfig.id}`);
  });
});
