import { handler } from '@/server/http';
export async function GET(req: Request, context: { params: Promise<{id:string}> }) { return handler('letter',(await context.params).id)(req); }
