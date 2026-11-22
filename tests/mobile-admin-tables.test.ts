import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DataTable} from '../src/ui/admin';
import {AdminAccess} from '../src/ui/admin-panels';
import type {ReadKind} from '../src/server/workflows/reads';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
it.each<ReadKind>(['audit','access-requests','tasks','missionaries','letters','notification-jobs','incidents'])('supplies labelled mobile card values and desktop headers for %s',kind=>{
  const html=renderToStaticMarkup(createElement(DataTable,{kind,items:[{id:'fictional',actorLabel:'staff@mission-care.test',reasonCode:'suspected_disclosure'}]}));
  expect(html).toContain('class="admin-data-table"');expect(html).toContain('data-label=');expect(html).toContain('<th scope="col"');
  if(kind==='audit') {expect(html).toContain('疑似資訊外洩');expect(html).not.toContain('suspected_disclosure');expect(html).toContain('staff@mission-care.test');}
});
it('does not render unknown reason codes and handles an empty list',()=>{
  expect(renderToStaticMarkup(createElement(DataTable,{kind:'audit',items:[{reasonCode:'unknown-internal-code'}]}))).not.toContain('unknown-internal-code');
  expect(renderToStaticMarkup(createElement(DataTable,{kind:'audit',items:[]}))).not.toContain('<table');
});
it('grant cards label expiry and revocation actions',()=>{
  const html=renderToStaticMarkup(createElement(AdminAccess,{requests:{items:[],count:0,next_offset:null},offset:0,grants:[{id:'grant',missionaryId:'m',missionaryCode:'M-02',memberCode:'U-FICTIONAL',requestId:null,expiresAt:new Date('2030-01-01'),revokedAt:null}]}));
  expect(html).toContain('data-label="有效期限"');expect(html).toContain('table-value table-nowrap');expect(html).toContain('data-label="操作"');expect(html).toContain('撤銷權限');
});
