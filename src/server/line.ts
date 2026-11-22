import { z } from 'zod';
const claims = z.object({ iss: z.literal('https://access.line.me'), aud: z.string(), exp: z.number(), nonce: z.string(), sub: z.string().min(1) });
export type LineVerifier = (idToken: string, nonce: string, channel: string) => Promise<unknown>;
export const verifyLine: LineVerifier = async (idToken,nonce,channel) => {
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify',{ method:'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id_token:idToken, client_id:channel, nonce }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Invalid identity'); return response.json();
};
export async function lineSubject(verifier: LineVerifier, token: string, nonce: string, channel: string, now: Date) { const c = claims.parse(await verifier(token,nonce,channel)); if (c.aud !== channel || c.nonce !== nonce || c.exp <= now.getTime()/1000) throw new Error('Invalid identity'); return c.sub; }
