import { randomUUID } from 'node:crypto';
import { workflowDependencies } from '@/server/workflow-http';
import { devLogin } from '@/server/dev-login';
import { mutationGuard, memberCookie } from '@/server/http';
import { ApiError } from '@/server/services';
import { MemoryRateLimiter } from '@/server/security';
const limiter=new MemoryRateLimiter(20);
export async function POST(req:Request) {
  const request_id=randomUUID();const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json','X-Request-Id':request_id});
  try {
    if(process.env.NODE_ENV!=='development'||process.env.MC_LOCAL_DB!=='1'||process.env.MC_DEV_LOGIN!=='1')return Response.json({error:{code:'not_found'},request_id},{status:404,headers});
    mutationGuard(req,process.env.APP_ORIGIN??'https://localhost:3000');
    if(!limiter.consume('dev'))return Response.json({error:{code:'rate_limited'},request_id},{status:429,headers});
    const {core}=workflowDependencies();const token=await devLogin(core.auth);
    await core.audit(core.db,{actorId:(await core.auth.member(token)).id,action:'auth.dev',requestId:request_id});
    headers.set('Set-Cookie',`${memberCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
    return Response.json({data:{authenticated:true},request_id},{headers});
  }catch(error){return Response.json({error:{code:error instanceof ApiError?error.code:'internal_error'},request_id},{status:error instanceof ApiError?error.status:500,headers});}
}
