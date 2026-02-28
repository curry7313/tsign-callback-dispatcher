import { describe, it, expect } from 'vitest';
import {
  decryptAES256CBC,
  encryptAES256CBC,
  verifySignature,
  generateSignature,
  generateEncryptKey,
  generateSignToken,
  generateId,
} from '../../src/utils/crypto.util';

// 固定测试用 key：32 字符 hex 字符串，UTF-8 编码后 32 字节
const TEST_KEY = 'CC23FB38AE1D47B09D939CFBAE64195F';

describe('crypto.util', () => {
  // ──────── 加解密 ────────

  describe('encryptAES256CBC / decryptAES256CBC', () => {
    it('加密后解密应还原明文', () => {
      const plaintext = '{"MsgId":"yDtKOUUckpfzn1drUP8YGQwIiomArVih","MsgType":"TemplateAdd","MsgVersion":"CustomApp","MsgData":{"OrganizationId":"yDwJvUUckpk5rwf8Uxh4PcT1e3NS5wQn","OperatorUserId":"yDwJCUUckpk0y11sUxGkg4n1WsBQNkIp","TemplateId":"yDtKOUUckpfzdllkUuSHDA1uMECpNeoa","TemplateName":"sale-v1","CreateTime":1767146542}}';
	  const encrypted = encryptAES256CBC(plaintext, TEST_KEY);
      const decrypted = decryptAES256CBC(encrypted, TEST_KEY);
      expect(decrypted).toBe(plaintext);
    });

	it('加密结果和官方一致',()=>{
	  const encryptedExp =  'VV/zit1H66SsjoJ/yy6ezfESfFGjaoMCDElrlnnPf75bD6yWyRYnvLs+DJh8nR1+DOhtRKClQeLM69rBScm2nlS6NcxqAHm9aIlvl4dbp+OxVOmEwWb9nRV4l889u89RwV6BHtNpiwQN5x/e7f3Q1X6feX+zK78Sh3sP81KSIn7kEyrZSXlShJoY/mauraMiOldmMDzZ1AtiJ8nQ3S8L9W/WLoqgfeR8QnbsPkVYecuTdQAuA991C5ohw3OGTkaW5NiEVrRZ+EVi8OmacM6HuPZ0AWArQ1CE30d1PnWBwKXqLHdxqI8Jzk4DVC8ICDSjvuGiHJbupiFjo/f8IDHoJn96GPIed5mNBsZtFoHTqcTgn82nfzYBTZ4ExjFF4ONhgou2uvgXUwaT+2a/rVKRkYGQnoaB1R1kMEsUD8pYxcE='
      const plaintext = '{"MsgId":"yDtKOUUckpfzn1drUP8YGQwIiomArVih","MsgType":"TemplateAdd","MsgVersion":"CustomApp","MsgData":{"OrganizationId":"yDwJvUUckpk5rwf8Uxh4PcT1e3NS5wQn","OperatorUserId":"yDwJCUUckpk0y11sUxGkg4n1WsBQNkIp","TemplateId":"yDtKOUUckpfzdllkUuSHDA1uMECpNeoa","TemplateName":"sale-v1","CreateTime":1767146542}}';
      const encrypted = encryptAES256CBC(plaintext, TEST_KEY);
      expect(encrypted).toBe(encryptedExp);
  	}	);
    it('加密结果应为合法 base64', () => {
      const encrypted = encryptAES256CBC('hello', TEST_KEY);
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      // base64 重新编码应与原值一致
      expect(Buffer.from(encrypted, 'base64').toString('base64')).toBe(encrypted);
    });

    it('相同明文多次加密结果应一致（IV 固定由 key 前 16 字节决定）', () => {
      const plaintext = 'deterministic test';
      const enc1 = encryptAES256CBC(plaintext, TEST_KEY);
      const enc2 = encryptAES256CBC(plaintext, TEST_KEY);
      expect(enc1).toBe(enc2);
    });

    it('不同 key 加密结果应不同', () => {
      const plaintext = 'same message';
      const key2 = 'DD23FB38AE1D47B09D939CFBAE64195F';
      const enc1 = encryptAES256CBC(plaintext, TEST_KEY);
      const enc2 = encryptAES256CBC(plaintext, key2);
      expect(enc1).not.toBe(enc2);
    });

    it('用错误 key 解密应抛异常', () => {
      const encrypted = encryptAES256CBC('secret', TEST_KEY);
      const wrongKey = 'DD23FB38AE1D47B09D939CFBAE64195F';
      expect(() => decryptAES256CBC(encrypted, wrongKey)).toThrow();
    });

    it('空字符串加解密', () => {
      const encrypted = encryptAES256CBC('', TEST_KEY);
      const decrypted = decryptAES256CBC(encrypted, TEST_KEY);
      expect(decrypted).toBe('');
    });

    it('中文内容加解密', () => {
      const plaintext = '{"MsgType":"合同签署","data":"测试中文内容🎉"}';
      const encrypted = encryptAES256CBC(plaintext, TEST_KEY);
      const decrypted = decryptAES256CBC(encrypted, TEST_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it('长文本加解密', () => {
      const plaintext = JSON.stringify({
        MsgId: 'long-test',
        MsgType: 'ContractSign',
        MsgData: { content: 'x'.repeat(10000) },
      });
      const encrypted = encryptAES256CBC(plaintext, TEST_KEY);
      const decrypted = decryptAES256CBC(encrypted, TEST_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it('key 长度不为 32 字节应抛异常', () => {
      expect(() => encryptAES256CBC('test', 'short_key')).toThrow();
      expect(() => decryptAES256CBC('dGVzdA==', 'short_key')).toThrow();
    });

    it('非法 base64 密文解密应抛异常', () => {
      expect(() => decryptAES256CBC('not-valid-base64!!!', TEST_KEY)).toThrow();
    });
  });

  // ──────── 签名 ────────

  describe('generateSignature / verifySignature', () => {
    const token = 'test_token_123';
    const timestamp = '1700000000';
    const nonce = 'abc123';
    const encrypt = 'some_encrypted_data';

    it('generateSignature 应返回 40 字符的 hex SHA1', () => {
      const sig = generateSignature(token, timestamp, nonce, encrypt);
      expect(sig).toMatch(/^[0-9a-f]{40}$/);
    });

    it('verifySignature 应验证通过正确签名', () => {
      const sig = generateSignature(token, timestamp, nonce, encrypt);
      expect(verifySignature(token, timestamp, nonce, encrypt, sig)).toBe(true);
    });

    it('verifySignature 应拒绝错误签名', () => {
      expect(verifySignature(token, timestamp, nonce, encrypt, 'wrong_signature')).toBe(false);
    });

    it('参数顺序不影响签名结果（内部会排序）', () => {
      const sig1 = generateSignature('a', 'b', 'c', 'd');
      const sig2 = generateSignature('a', 'b', 'c', 'd');
      expect(sig1).toBe(sig2);
    });

    it('任一参数不同签名应不同', () => {
      const sig1 = generateSignature(token, timestamp, nonce, encrypt);
      const sig2 = generateSignature(token, timestamp, nonce, 'different_data');
      expect(sig1).not.toBe(sig2);
    });
  });

  // ──────── 加密+签名 端到端 ────────

  describe('加密 + 签名端到端', () => {
    it('加密→签名→验签→解密 完整流程', () => {
      const key = generateEncryptKey();
      const token = generateSignToken();
      const message = JSON.stringify({ MsgId: 'e2e-test', MsgType: 'TestType' });

      // 加密
      const encrypted = encryptAES256CBC(message, key);

      // 签名
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = 'test_nonce_value';
      const signature = generateSignature(token, timestamp, nonce, encrypted);

      // 验签
      expect(verifySignature(token, timestamp, nonce, encrypted, signature)).toBe(true);

      // 解密
      const decrypted = decryptAES256CBC(encrypted, key);
      expect(JSON.parse(decrypted)).toEqual({ MsgId: 'e2e-test', MsgType: 'TestType' });
    });
  });

  // ──────── 生成工具函数 ────────

  describe('generateEncryptKey', () => {
    it('应生成 32 字符的 hex 字符串', () => {
      const key = generateEncryptKey();
      expect(key).toHaveLength(32);
      expect(key).toMatch(/^[0-9a-f]{32}$/);
    });

    it('UTF-8 编码后应为 32 字节', () => {
      const key = generateEncryptKey();
      expect(Buffer.from(key, 'utf-8').length).toBe(32);
    });

    it('每次生成的 key 应不同', () => {
      const key1 = generateEncryptKey();
      const key2 = generateEncryptKey();
      expect(key1).not.toBe(key2);
    });

    it('生成的 key 可用于加解密', () => {
      const key = generateEncryptKey();
      const msg = 'test with generated key';
      const encrypted = encryptAES256CBC(msg, key);
      expect(decryptAES256CBC(encrypted, key)).toBe(msg);
    });
  });

  describe('generateSignToken', () => {
    it('应生成 32 字符的 hex 字符串', () => {
      const token = generateSignToken();
      expect(token).toHaveLength(32);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
    });

    it('每次生成应不同', () => {
      const t1 = generateSignToken();
      const t2 = generateSignToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('generateId', () => {
    it('应生成 UUID 格式', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('每次生成应不同', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });
});
