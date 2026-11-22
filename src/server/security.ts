import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export async function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password,salt,64) as Buffer).toString('hex')}`; }
export async function verifyPassword(password: string, stored: string) { const [salt,key] = stored.split(':'); if (!salt || !key || key.length !== 128) return false; return timingSafeEqual(await scrypt(password,salt,64) as Buffer,Buffer.from(key,'hex')); }
export function encryptSecret(value: string, key: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv); return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64'); }
export function decryptSecret(value: string, key: string) { const b = Buffer.from(value,'base64'); const decipher = createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12)); decipher.setAuthTag(b.subarray(-16)); return Buffer.concat([decipher.update(b.subarray(12,-16)),decipher.final()]).toString(); }
export interface RateLimiter { consume(key: string): boolean }
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string,{ count: number; until: number }>();
  constructor(private limit = 30, private windowMs = 60_000) {}
  consume(key: string) { const now = Date.now(); for (const [k,v] of this.buckets) if (v.until <= now) this.buckets.delete(k); const b = this.buckets.get(key) ?? { count: 0, until: now + this.windowMs }; this.buckets.set(key,b); return ++b.count <= this.limit; }
}
