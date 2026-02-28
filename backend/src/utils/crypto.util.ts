import crypto from 'crypto';

/**
 * AES-256-CBC 解密
 * key 直接 UTF-8 编码为 32 字节，前 16 字节作为 IV，标准 PKCS7 自动填充
 */
export function decryptAES256CBC(encryptedBase64: string, encryptKey: string): string {
  const rawKey = Buffer.from(encryptKey, 'utf-8');
  const iv = rawKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', rawKey, iv);
  let decrypted = decipher.update(Buffer.from(encryptedBase64, 'base64'), undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  msgSignature: string
): boolean {
  const sortedArr = [token, timestamp, nonce, encrypt].sort();
  const str = sortedArr.join('');
  const hash = crypto.createHash('sha1').update(str).digest('hex');
  return hash === msgSignature;
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 生成 32 字符的加密密钥（UTF-8 编码后恰好 32 字节，满足 AES-256 要求）
 */
export function generateEncryptKey(): string {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars = 32 bytes UTF-8
}

export function generateSignToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * AES-256-CBC 加密（e签宝官方实现）
 * key 直接 UTF-8 编码为 32 字节，前 16 字节作为 IV，标准 PKCS7 自动填充
 */
export function encryptAES256CBC(message: string, encryptKey: string): string {
  const rawKey = Buffer.from(encryptKey, 'utf-8');
  const iv = rawKey.subarray(0, 16);
  const cipher = crypto.createCipheriv('aes-256-cbc', rawKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(message, 'utf-8')),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

export function generateSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string
): string {
  const sortedArr = [token, timestamp, nonce, encrypt].sort();
  const str = sortedArr.join('');
  return crypto.createHash('sha1').update(str).digest('hex');
}
