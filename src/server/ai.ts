import { z } from 'zod';
export const aiOutput = z.object({
  safe_summary: z.string().max(5000), prayer_points: z.array(z.string().max(2000)).max(20),
  risk_flags: z.array(z.string().max(80)).max(30),
  source_spans: z.array(z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).strict()).max(100),
  needs_human_review: z.literal(true),
}).strict();
export type AiOutput = z.infer<typeof aiOutput>;
export interface AiProvider { external: boolean; draft(raw: string): Promise<unknown> }
const patterns: [string,RegExp][] = [
  ['coordinates', /[-+]?\d{1,3}\.\d{3,}\s*[,，]\s*[-+]?\d{1,3}\.\d{3,}/],
  ['phone', /(?:\+?\d[\s()-]*){8,}/], ['email', /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i],
  ['url', /(?:https?:\/\/|www\.)\S+/i],
  ['location', /(?:[\p{L}]{1,12}[市縣區鄉鎮路街巷號]|\b(?:city|street|road|avenue|taipei|tokyo|london)\b)/iu],
  ['minor_or_age', /(?:\b(?:age[ds]?\s*\d+|minor|child|children)\b|\d{1,2}\s*歲|未成年|兒童|小孩)/i],
  ['date_or_itinerary', /(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|行程|抵達|出發|航班|\b(?:tomorrow|flight|itinerary|arrive|depart)\b)/i],
  ['prompt_injection', /(?:ignore\s+(?:all\s+)?(?:previous|prior)|system\s*prompt|developer\s*message|忽略.*(?:指令|規則)|直接發[佈布]|繞過.*審核)/i],
];
export function scanSensitive(raw: string) { return patterns.filter(([,p])=>p.test(raw)).map(([flag])=>flag); }
export const localAi: AiProvider = { external:false, async draft() { return {safe_summary:'',prayer_points:[],risk_flags:[],source_spans:[],needs_human_review:true}; } };
export async function draftSafely(raw: string, restricted: boolean, provider: AiProvider = localAi, externalAllowed = false): Promise<AiOutput> {
  const flags = scanSensitive(raw);
  const selected = provider.external && (restricted || flags.length > 0 || !externalAllowed) ? localAi : provider;
  const result = aiOutput.parse(await selected.draft(raw));
  if (result.source_spans.some(s=>s.end<s.start || s.end>raw.length)) throw new Error('Invalid source span');
  return {...result,risk_flags:[...new Set([...flags,...result.risk_flags])],needs_human_review:true};
}
