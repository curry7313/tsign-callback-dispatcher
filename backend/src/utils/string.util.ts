/** Mask username: keep first char, mask the rest with '*' */
export function maskUser(name: string): string {
  if (!name) return '***';
  if (name.length <= 1) return name[0] + '**';
  return name[0] + '*'.repeat(Math.min(name.length - 1, 5));
}

/** Mask a secret string: show first 4 and last 4, mask the middle */
export function maskSecret(secret: string): string {
  if (!secret || secret.length <= 8) return secret ? '********' : '';
  return secret.substring(0, 4) + '****' + secret.substring(secret.length - 4);
}
