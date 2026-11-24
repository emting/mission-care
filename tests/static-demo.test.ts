import {it,expect} from 'vitest';
import {assertSafeDemo,assertDemoReferences,demoFile,relativeDemoPath} from '../scripts/static-demo-safety';
import {staticDemoDocument} from '../scripts/static-demo-document';

const file=(text:string,name='index.html')=>({name,bytes:Buffer.from(text)});
it('keeps the browser snapshot function self-contained when serialized',()=>{
  expect(staticDemoDocument.toString()).not.toContain('__name(');
});
it('maps fixed route families and notification tabs to relative static files',()=>{
  expect(demoFile('member','/app')).toBe('member/app/index.html');
  expect(demoFile('roles/editor','/admin/letters/fictional')).toBe('roles/editor/admin/letters/fictional/index.html');
  expect(demoFile('roles/mission_lead','/admin/notifications?tab=sent')).toBe('roles/mission_lead/admin/notifications/sent/index.html');
  expect(relativeDemoPath('member/app/privacy/index.html','index.html')).toBe('../../../index.html');
  expect(relativeDemoPath('roles/editor/admin/index.html','assets/demo.css')).toBe('../../../assets/demo.css');
});
it('accepts inert fictional pages, empty output and harmless binary assets',()=>{
  expect(()=>assertSafeDemo([],[])).not.toThrow();
  expect(()=>assertSafeDemo([file('<form disabled=""><input disabled=""><button disabled="">展示</button></form>'),file('image','assets/photo.webp')],['fictional-secret'])).not.toThrow();
});
it('checks nested page, stylesheet and image references and rejects missing/external files',()=>{
  const files=[file('<a href="../index.html">入口</a><link href="../assets/demo.css"><img src="../assets/photo.webp">','nested/index.html'),file(''),file('body{background:url("photo.webp")}','assets/demo.css'),file('image','assets/photo.webp')];
  expect(()=>assertDemoReferences(files)).not.toThrow();
  expect(()=>assertDemoReferences([])).not.toThrow();
  expect(()=>assertDemoReferences([file('<a href="missing.html">缺頁</a>')])).toThrow('uncaptured');
  expect(()=>assertDemoReferences([file('<img src="https://example.test/photo.webp">')])).toThrow('uncaptured');
});
it.each(['password-value','TOTP-VALUE','cookie-token'])('fails closed on an exact secret value, even in binary assets (%s)',secret=>{
  expect(()=>assertSafeDemo([file('binary '+secret,'assets/photo.webp')],[secret])).toThrow('credential/session');
});
it.each([
  'request_id: 00000000-0000-4000-8000-000000000001',
  '<span title="00000000-0000-4000-8000-000000000001">request_id</span>',
  'U0123456789abcdef0123456789abcdef',
  '__Host-mc_member=fictional',
  '<script>fetch("/api/auth/dev")</script>',
  '<button onclick="alert(1)" disabled="">展示</button>',
  '<form action="/api/prayers" disabled=""></form>',
  '<input>',
  '<a href="/app">錯誤路徑</a>',
  '<a href="javascript:alert(1)">錯誤連結</a>',
])('rejects sensitive or active output (%s)',text=>{
  expect(()=>assertSafeDemo([file(text)],[])).toThrow('Static demo safety check failed');
});
