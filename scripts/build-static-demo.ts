import {spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {once} from 'node:events';
import {chromium,type BrowserContext,type APIResponse} from '@playwright/test';
import {authenticator} from 'otplib';
import {adminNavigation,roleLabels} from '../src/ui/navigation';
import {permissions,type Role} from '../src/server/policy';
import {staticDemoDocument} from './static-demo-document';
import {assertSafeDemo,assertDemoReferences,demoFile,relativeDemoPath} from './static-demo-safety';

type Ready={origin:string;member:string;fixtureSecrets:string[];config:{password:string;authKey:string;subjectKey:string;totp:Record<string,string>}};
type Capture={scope:string;route:string;file:string;html?:string};
const roles:Role[]=['church_owner','mission_lead','editor','reviewer','access_reviewer','security_auditor','finance_link_manager','support'];
let stage='isolated production build';
const sensitiveValues:string[]=[];
const demoCss=`
.skip-link:focus{z-index:10001}
@media(min-width:761px){.admin-sidebar{overflow-y:auto;overscroll-behavior:contain}.admin-sidebar>*{flex-shrink:0}}
:root{--demo-height:112px}body{margin:0}.demo-banner{position:sticky;top:0;z-index:10000;height:var(--demo-height);box-sizing:border-box;background:#183e34;color:#fff;padding:16px 22px;display:flex;flex-direction:column;justify-content:center;gap:8px;font:16px/1.5 system-ui,sans-serif}.demo-banner strong{font-weight:650}.demo-banner nav{display:flex;gap:24px;flex-wrap:wrap}.demo-banner a{color:#fff;text-decoration:underline;font-size:15px}.admin-sidebar{top:var(--demo-height)}.admin-topbar{top:var(--demo-height)}button:disabled,input:disabled,select:disabled,textarea:disabled{cursor:not-allowed}.demo-home{background:#f6f7f1;color:#193d32;min-height:100vh;font:18px/1.7 system-ui,sans-serif}.demo-home main{max-width:1000px;margin:auto;padding:50px 22px}.demo-home h1{font-size:clamp(30px,6vw,46px);line-height:1.3}.demo-home .demo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin:30px 0}.demo-home .demo-card{padding:26px;border:1px solid #cbd6ca;border-radius:16px;background:white;text-decoration:none;color:#193d32}.demo-card strong{display:block;font-size:22px;margin-bottom:10px}.demo-home a:focus-visible{outline:3px solid #8c621e;outline-offset:4px}@media(max-width:760px){.admin-sidebar{position:static;transform:none;width:100%;box-shadow:none}.admin-shell{display:block}.admin-sidebar .sidebar-foot{display:none}.mobile-menu{display:none!important}.admin-topbar{top:var(--demo-height)}.demo-banner{font-size:15px;padding:12px 18px}}
`;

async function run(command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,quiet=false) {
  const child=spawn(command,args,{cwd,env,stdio:quiet?'ignore':'inherit'});
  const [code]=await once(child,'exit');if(code!==0) throw Error(`Demo subprocess failed: ${command}`);
}

function entry(title:string,content:string,depth='') {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${title}｜Mission Care 展示版</title><link rel="stylesheet" href="${depth}assets/demo.css"></head><body class="demo-home"><aside class="demo-banner" aria-label="展示版說明"><strong>展示版・全部為虛構資料・無法登入、無法儲存</strong><nav aria-label="展示版導覽"><a href="${depth}index.html">展示入口</a><a href="${depth}member/app/index.html">會友平台</a><a href="${depth}admin/index.html">管理角色</a></nav></aside><main><p>Mission Care · 靜態導覽</p><h1>${title}</h1>${content}</main></body></html>`;
}

async function main() {
  const root=resolve('.');const work=await mkdtemp(join(tmpdir(),'mission-care-demo-'));
  const site=join(work,'site');let server:ChildProcess|undefined;
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    console.log('Demo: creating an isolated production build and fresh fictional seed.');
    for(const name of ['src','scripts','drizzle','package.json','pnpm-lock.yaml','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs'])
      await cp(join(root,name),join(work,name),{recursive:true});
    await symlink(join(root,'node_modules'),join(work,'node_modules'),'dir');
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',CI:'1',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_LIFF_ID:''};
    await run('pnpm',['build'],work,env);
    await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','demo-key.pem','-out','demo-cert.pem','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],work,env,true);
    console.log('Demo: starting the private production server and mock member session.');
    stage='private seed/server startup';
    server=spawn(process.execPath,['--import','tsx','scripts/static-demo-server.ts'],{cwd:work,env,stdio:['ignore','ignore','ignore','ipc']});
    const ready=await new Promise<Ready>((accept,reject)=>{
      const timer=setTimeout(()=>reject(Error('Private demo server startup timed out')),120000);
      server!.once('message',(message:Ready|{error:string})=>{clearTimeout(timer);if('error' in message) reject(Error(message.error));else accept(message);});
      server!.once('exit',()=>{clearTimeout(timer);reject(Error('Private demo server exited'));});
    });
    const secrets=sensitiveValues;secrets.push(ready.member,...ready.fixtureSecrets,ready.config.password,ready.config.authKey,ready.config.subjectKey,...Object.values(ready.config.totp));
    stage='browser/session setup and authorized route discovery';
    browser=await chromium.launch({headless:true});
    await mkdir(join(site,'assets'),{recursive:true});await writeFile(join(site,'assets/demo.css'),demoCss);
    const captures:Capture[]=[];
    const contexts=new Map<string,BrowserContext>();
    async function context(scope:string) {
      const ctx=await browser!.newContext({ignoreHTTPSErrors:true,timezoneId:'Asia/Taipei',viewport:{width:1440,height:1000}});
      await ctx.route('**/*',route=>new URL(route.request().url()).origin===ready.origin?route.continue():route.abort());
      contexts.set(scope,ctx);return ctx;
    }
    const member=await context('member');
    await context('landing');add('landing','/app');
    await member.addCookies([{name:'__Host-mc_member',value:ready.member,url:ready.origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
    async function data<T>(ctx:BrowserContext,path:string):Promise<T> {
      const response=await ctx.request.get(ready.origin+path);if(!response.ok()) throw Error(`Demo discovery failed: ${path.split('?')[0]} (${response.status()})`);
      return (await response.json()).data as T;
    }
    function add(scope:string,route:string) {captures.push({scope,route,file:demoFile(scope,route)});}
    add('member','/app');add('member','/app/privacy');
    for(const missionary of await data<{id:string}[]>(member,'/api/missionaries')) add('member','/app/missionaries/'+missionary.id);
    for(const letter of (await data<{items:{id:string}[]}>(member,'/api/letters')).items) add('member','/app/letters/'+letter.id);
    function collectCookies(response:APIResponse) {
      for(const header of response.headersArray()) if(header.name.toLowerCase()==='set-cookie') {
        const value=header.value.split(';')[0].split('=').slice(1).join('=');if(value) secrets.push(value);
      }
    }
    for(const role of roles) {
      const scope='roles/'+role;const ctx=await context(scope);
      const post=async(path:string,body:unknown)=>{
        const response=await ctx.request.post(ready.origin+path,{headers:{Origin:ready.origin,'x-mc-csrf':'1'},data:body});
        collectCookies(response);if(!response.ok()) throw Error(`Demo staff sign-in failed (${role}, ${response.status()})`);
      };
      await post('/api/admin/auth/password',{email:role+'@mission-care.test',password:ready.config.password});
      await post('/api/admin/auth/mfa',{code:authenticator.generate(ready.config.totp[role])});
      for(const nav of adminNavigation.filter(nav=>permissions[role].some(permission=>permission===nav.permission))) add(scope,nav.path);
      if(permissions[role].some(permission=>permission==='assign')) {
        add(scope,'/admin/notifications?tab=sent');add(scope,'/admin/notifications?tab=preferences');
        add(scope,'/admin/notifications?tab=pending');
      }
      for(const kind of ['letters','missionaries']) {
        if(!adminNavigation.some(nav=>nav.path==='/admin/'+kind&&permissions[role].some(permission=>permission===nav.permission))) continue;
        for(const row of (await data<{items:{id:string}[]}>(ctx,`/api/admin/${kind}?limit=50`)).items) add(scope,`/admin/${kind}/${row.id}`);
      }
    }
    const assets:Record<string,string>={};
    async function asset(url:string,ctx:BrowserContext):Promise<string> {
      if(assets[url]) return assets[url];
      if(new URL(url).origin!==ready.origin) throw Error('External demo asset rejected');
      const response=await ctx.request.get(url);if(!response.ok()) throw Error('Demo asset capture failed');
      const css=response.headers()['content-type']?.includes('text/css');
      const extension=css?'.css':new URL(url).pathname.startsWith('/api/media/')?'.webp':extname(new URL(url).pathname);
      if(!['.css','.webp','.png','.jpg','.jpeg','.svg','.woff','.woff2','.ttf','.ico'].includes(extension)) throw Error('Unexpected demo asset type');
      const file='assets/'+createHash('sha256').update(url.replace(ready.origin,'')).digest('hex').slice(0,20)+extension;
      assets[url]=file;let bytes=await response.body();
      if(css) {
        let text=bytes.toString();
        if(/@import\b/i.test(text)) throw Error('CSS imports must be captured explicitly');
        for(const match of [...text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)]) {
          if(match[1].startsWith('data:')) continue;
          const dependency=await asset(new URL(match[1],url).href,ctx);
          text=text.replaceAll(match[0],`url("${relativeDemoPath(file,dependency)}")`);
        }
        bytes=Buffer.from(text);
      }
      await writeFile(join(site,file),bytes);return file;
    }
    console.log(`Demo: capturing ${captures.length} authorized routes across member and staff contexts.`);
    for(const capture of captures) {
      stage=`capture (${capture.scope}, ${capture.route.split('/')[2]??'overview'})`;
      const ctx=contexts.get(capture.scope)!;const page=await ctx.newPage();
      const response=await page.goto(ready.origin+capture.route,{waitUntil:'networkidle'});
      if(response?.status()!==200) throw Error(`Demo capture refused (${capture.scope}, ${capture.route.split('/')[1]}, ${response?.status()})`);
      if(new URL(page.url()).pathname!==new URL(capture.route,ready.origin).pathname) throw Error('Unexpected demo login redirect');
      if(capture.route.startsWith('/app/letters/')) await page.locator('.member-letter h1').waitFor();
      if(await page.getByRole('heading',{name:'資料暫不可用',exact:true}).count()) throw Error('Demo page contains unavailable data');
      const urls=await page.locator('link[rel="stylesheet"],img[src]').evaluateAll(elements=>elements.map(el=>new URL(el.getAttribute(el.tagName==='LINK'?'href':'src')!,location.href).href));
      for(const url of urls) await asset(url,ctx);
      const routes:Record<string,string>={'/':'index.html'};
      for(const other of captures) if(other.scope==='member'||other.scope===capture.scope) routes[other.route]=other.file;
      if(capture.scope==='member') routes['/admin']='admin/index.html';
      capture.html=await page.evaluate(staticDemoDocument,{file:capture.file,routes,assets});
      await page.close();
      await mkdir(join(site,capture.file,'..'),{recursive:true});await writeFile(join(site,capture.file),capture.html);
    }
    await mkdir(join(site,'admin'),{recursive:true});await mkdir(join(site,'unavailable'),{recursive:true});
    await writeFile(join(site,'index.html'),entry('以關懷相連，以代禱同行。','<p>這是公開的靜態展示，不需要帳號。瀏覽虛構畫面，了解不同角色如何一起守護關懷與隱私。所有操作均已停用，沒有登入或儲存功能。</p><div class="demo-grid"><a class="demo-card" href="member/app/index.html"><strong>會友平台 →</strong>閱讀近況、代禱與閱讀權限</a><a class="demo-card" href="admin/index.html"><strong>管理工作空間 →</strong>選擇角色，探索核對與審閱流程</a></div><p><a href="landing/app/index.html">觀看會友登入說明（無法登入） →</a></p>'));
    await writeFile(join(site,'admin/index.html'),entry('選擇管理展示角色',`<p>角色只用來切換已生成的靜態畫面，不代表取得任何真實權限。每個角色只展示其授權範圍內的虛構資料。</p><p>教會治理負責人僅具治理與稽核權限，四張待辦卡片皆不在其授權範圍；不是資料遺漏。內容審核、閱讀權限及通知異常請選差傳主管；安全事件請選安全稽核；奉獻連結提案請選奉獻連結管理。</p><p><a href="../roles/mission_lead/admin/index.html">先看有待辦的差傳主管總覽 →</a></p><div class="demo-grid">${roles.map(role=>`<a class="demo-card" href="../roles/${role}/admin/index.html"><strong>${roleLabels[role]} →</strong>${role}</a>`).join('')}</div>`,'../'));
    await writeFile(join(site,'unavailable/index.html'),entry('展示版不提供此功能','<p>此連結尚未納入靜態導覽，或需要真正的互動。展示版不會登入、送出資料、發送訊息或處理奉獻。</p><p><a href="../index.html">返回展示入口 →</a></p>','../'));
    const files:{name:string;bytes:Buffer}[]=[];
    async function list(dir:string,prefix='') {
      for(const item of await readdir(dir,{withFileTypes:true})) {
        const name=prefix+item.name;if(item.isDirectory()) await list(join(dir,item.name),name+'/');
        else files.push({name,bytes:await readFile(join(dir,item.name))});
      }
    }
    stage='output safety and link checks';
    await list(site);assertSafeDemo(files,secrets);assertDemoReferences(files);
    await rm(join(root,'demo-site'),{recursive:true,force:true});await cp(site,join(root,'demo-site'),{recursive:true});
    console.log(`PASS demo safety grep: ${files.length} files; no seeded credentials, session/cookie values, request UUIDs, LINE UIDs or active scripts.`);
    console.log(`PASS static demo: ${captures.length+3} HTML pages; ${Object.keys(assets).length} captured assets; output demo-site/.`);
  } finally {
    await browser?.close();
    if(server&&server.exitCode===null) {
      const exited=once(server,'exit');server.kill('SIGTERM');
      const timer=setTimeout(()=>server?.kill('SIGKILL'),10000);await exited;clearTimeout(timer);
    }
    await rm(work,{recursive:true,force:true});
  }
}

main().catch(error=>{
  let message=error instanceof Error?error.message:'Unknown failure';
  for(const secret of sensitiveValues) if(secret) message=message.replaceAll(secret,'[redacted]');
  console.error(`Static demo build failed during ${stage}; no unverified output was published. ${message}`);process.exitCode=1;
});
