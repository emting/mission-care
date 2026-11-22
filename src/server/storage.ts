import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fail } from './services';
export interface PrivateStorage { put(data: Buffer): Promise<string>; get(key: string): Promise<Buffer> }
export class LocalPrivateStorage implements PrivateStorage {
  constructor(private root = resolve(process.env.PRIVATE_MEDIA_DIR ?? './private-media')) {
    const publicDir = resolve('public');
    if (resolve(root) === publicDir || resolve(root).startsWith(publicDir+sep)) throw new Error('Private storage cannot be public');
  }
  private path(key: string) { if (!/^[\da-f-]{36}$/.test(key)) throw new Error('Invalid storage key'); return resolve(this.root,key); }
  async put(data: Buffer) { await mkdir(this.root,{recursive:true,mode:0o700}); const key=randomUUID(); await writeFile(this.path(key),data,{mode:0o600,flag:'wx'}); return key; }
  async get(key: string) { return readFile(this.path(key)); }
}
export async function sanitizeImage(bytes: Buffer) {
  if (!bytes.length || bytes.length>5*1024*1024) return fail(400,'invalid_image');
  try {
    const image=sharp(bytes,{limitInputPixels:20_000_000,animated:false}); const metadata=await image.metadata();
    if (!metadata.format || !['jpeg','png','webp'].includes(metadata.format) || (metadata.pages ?? 1)>1) return fail(400,'invalid_image');
    return await image.rotate().webp({quality:85}).toBuffer();
  } catch { return fail(400,'invalid_image'); }
}
