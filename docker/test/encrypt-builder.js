#!/usr/bin/env node
/**
 * 加密构造器 - 读取明文消息，加密后生成 curl 命令
 *
 * 加密方式：e签宝官方实现
 *   - key 直接 UTF-8 编码为 32 字节 Buffer
 *   - 前 16 字节作为 IV
 *   - AES-256-CBC，标准 PKCS7 自动填充
 *
 * 环境变量:
 *   ENCRYPT_KEY  - AES 加密密钥 (32 字符字符串，UTF-8 编码后 32 字节)
 *   TOKEN        - 签名 token (可为空，为空不带签名参数)
 *   BODYS_FILE   - bodys 文件路径
 *   LINE_NUM     - 指定行号 (可选，为空则处理全部)
 *   TARGET_URL   - 目标地址
 *   DEBUG        - 设置为 "1" 启用调试输出
 */

const crypto = require('crypto');
const fs = require('fs');

const encryptKey = process.env.ENCRYPT_KEY || '';
const token = process.env.TOKEN || '';
const bodysFile = process.env.BODYS_FILE || '';
const lineNum = process.env.LINE_NUM || '';
const targetUrl = process.env.TARGET_URL || '';
const debug = process.env.DEBUG === '1';

// ──────── 调试辅助 ────────
function log(...args) {
  if (debug) {
    console.error('[DEBUG]', ...args);
  }
}

// ──────── 验证 Key ────────
function validateKey(key) {
  log('原始 encryptKey:', key);
  log('encryptKey 长度:', key.length, '字符');

  const rawKey = Buffer.from(key, 'utf-8');
  log('UTF-8 编码后长度:', rawKey.length, '字节');

  if (rawKey.length !== 32) {
    throw new Error(
      `Invalid key length: 期望 32 字节 (UTF-8), 实际 ${rawKey.length} 字节。\n` +
      `  encryptKey="${key}" (${key.length} 字符)\n` +
      `  提示: encryptKey 应为 32 个 ASCII 字符的字符串（如 32 位 hex），UTF-8 编码后恰好 32 字节。\n` +
      `  可用 Node.js 生成: crypto.randomBytes(16).toString('hex')`
    );
  }

  const iv = rawKey.subarray(0, 16);
  log('IV (hex):', iv.toString('hex'));
  return { rawKey, iv };
}

// ──────── 加密（e签宝官方方式）────────
function encrypt(message, key) {
  const { rawKey, iv } = validateKey(key);
  const cipher = crypto.createCipheriv('aes-256-cbc', rawKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(message, 'utf-8')),
    cipher.final(),
  ]);
  log('明文长度:', message.length, '→ 密文长度:', encrypted.length);
  return encrypted.toString('base64');
}

// ──────── 解密（e签宝官方方式，调试用）────────
function decrypt(encryptedBase64, key) {
  const { rawKey, iv } = validateKey(key);
  const decipher = crypto.createDecipheriv('aes-256-cbc', rawKey, iv);
  let decrypted = decipher.update(Buffer.from(encryptedBase64, 'base64'), undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ──────── 签名 ────────
function sign(tkn, timestamp, nonce, encrypted) {
  const arr = [tkn, timestamp, nonce, encrypted].sort();
  return crypto.createHash('sha1').update(arr.join('')).digest('hex');
}

// ──────── 主逻辑 ────────
try {
  if (!encryptKey) {
    throw new Error('ENCRYPT_KEY 环境变量为空');
  }
  if (!bodysFile) {
    throw new Error('BODYS_FILE 环境变量为空');
  }
  if (!fs.existsSync(bodysFile)) {
    throw new Error(`bodys 文件不存在: ${bodysFile}`);
  }

  log('token:', token || '(空)');
  log('bodysFile:', bodysFile);
  log('lineNum:', lineNum || '(全部)');
  log('targetUrl:', targetUrl);

  // 先验证 key 是否合法
  validateKey(encryptKey);

  // 自检：加密→解密验证
  const testMsg = 'encrypt-builder-self-test';
  const testEnc = encrypt(testMsg, encryptKey);
  const testDec = decrypt(testEnc, encryptKey);
  if (testDec !== testMsg) {
    throw new Error(`加密自检失败: 加密→解密结果不匹配 ("${testDec}" !== "${testMsg}")`);
  }
  log('加密自检通过 ✓');

  const lines = fs.readFileSync(bodysFile, 'utf-8').trim().split('\n').filter(l => l.trim());
  log('bodys 总行数:', lines.length);

  if (lineNum) {
    const n = parseInt(lineNum);
    if (n < 1 || n > lines.length) {
      throw new Error(`行号 ${n} 超出范围 (共 ${lines.length} 行)`);
    }
  }

  const selectedLines = lineNum ? [lines[parseInt(lineNum) - 1]] : lines;
  const results = [];

  selectedLines.forEach((line, i) => {
    const idx = lineNum ? parseInt(lineNum) : i + 1;
    try {
      const plaintext = line.trim();
      log(`\n──── 第 ${idx} 行 ────`);
      log('明文长度:', plaintext.length);

      const encrypted = encrypt(plaintext, encryptKey);
      log('密文 (base64):', encrypted.substring(0, 60) + '...');

      // 验证：加密后立即解密，确保一致
      const verified = decrypt(encrypted, encryptKey);
      if (verified !== plaintext) {
        throw new Error('加密→解密验证失败: 明文不匹配');
      }
      log('加密→解密验证通过 ✓');

      const body = JSON.stringify({ encrypt: encrypted });
      let url;

      if (token) {
        const timestamp = String(Math.floor(Date.now() / 1000) + i);
        const nonce = crypto.randomUUID().replace(/-/g, '');
        const msgSignature = sign(token, timestamp, nonce, encrypted);
        url = targetUrl + '?timestamp=' + timestamp + '&nonce=' + nonce + '&msg_signature=' + msgSignature;
        log('timestamp:', timestamp);
        log('nonce:', nonce);
        log('msgSignature:', msgSignature);
      } else {
        url = targetUrl;
        log('token 为空，不带签名参数');
      }

      results.push({
        idx,
        preview: plaintext.substring(0, 100) + (plaintext.length > 100 ? '...' : ''),
        curl: `curl -s -X POST "${url}" -H "Content-Type: application/json" -d '${body}'`
      });
    } catch (e) {
      log(`第 ${idx} 行处理失败:`, e.message);
      results.push({ idx, error: e.message });
    }
  });

  console.log(JSON.stringify(results));

} catch (e) {
  console.error('[ERROR]', e.message);
  process.exit(1);
}
