import { encryptAES256CBC, generateSignature } from '../../src/utils/crypto.util';

export interface EncryptedCallbackRequest {
  body: { encrypt: string };
  query: { timestamp: string; nonce: string; msg_signature: string };
}

export function buildEncryptedCallback(
  message: Record<string, any>,
  encodingAESKey: string,
  token: string
): EncryptedCallbackRequest {
  const jsonStr = JSON.stringify(message);
  const encrypted = encryptAES256CBC(jsonStr, encodingAESKey);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = Math.random().toString(36).substring(2, 15);
  const msgSignature = generateSignature(token, timestamp, nonce, encrypted);

  return {
    body: { encrypt: encrypted },
    query: { timestamp, nonce, msg_signature: msgSignature },
  };
}

export function buildMockMessage(
  msgType: string,
  msgData: Record<string, any> = {}
): Record<string, any> {
  return {
    MsgId: `test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    MsgType: msgType,
    MsgVersion: 'v3',
    MsgData: {
      FlowId: `flow-${Date.now()}`,
      ...msgData,
    },
  };
}
