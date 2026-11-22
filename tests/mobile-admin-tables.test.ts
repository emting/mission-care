import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DataTable} from '../src/ui/admin';
import {AdminAccess} from '../src/ui/admin-panels';
import type {ReadKind} from '../src/server/workflows/reads';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
function expectAccessibleTable(html:string) {
  expect(html).toContain('<table class="admin-data-table" role="table">');
  expect(html).toContain('<thead role="rowgroup">');
  expect(html).toContain('<tbody role="rowgroup">');
  expect(html.match(/<tr\b[^>]*>/g)?.every(row=>row.includes('role="row"'))).toBe(true);
  expect(html.match(/<th\b[^>]*>/g)?.every(header=>header.includes('role="columnheader"'))).toBe(true);
  const cells=[...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
  expect(cells.length).toBeGreaterThan(0);
  for(const [,attributes,contents] of cells) {
    expect(attributes).toContain('role="cell"');
    const label=attributes.match(/data-label="([^"]+)"/)?.[1];
    expect(label).toBeTruthy();
    expect(contents).toContain(`<span class="table-label">${label}</span>`);
    expect(contents).not.toContain('aria-hidden="true"');
  }
}
it.each<ReadKind>(['audit','access-requests','tasks','missionaries','letters','notification-jobs','incidents'])('supplies labelled mobile card values and desktop headers for %s',kind=>{
  const html=renderToStaticMarkup(createElement(DataTable,{kind,items:[{id:'fictional',actorLabel:'staff@mission-care.test',reasonCode:'suspected_disclosure'}]}));
  expect(html).toContain('class="admin-data-table"');expect(html).toContain('data-label=');expect(html).toContain('<th scope="col"');
  expectAccessibleTable(html);
  if(kind==='audit') {expect(html).toContain('疑似資訊外洩');expect(html).not.toContain('suspected_disclosure');expect(html).toContain('staff@mission-care.test');}
});
it('does not render unknown reason codes and handles an empty list',()=>{
  expect(renderToStaticMarkup(createElement(DataTable,{kind:'audit',items:[{reasonCode:'unknown-internal-code'}]}))).not.toContain('unknown-internal-code');
  expect(renderToStaticMarkup(createElement(DataTable,{kind:'audit',items:[]}))).not.toContain('<table');
});
it('grant cards label expiry and revocation actions',()=>{
  const html=renderToStaticMarkup(createElement(AdminAccess,{requests:{items:[],count:0,next_offset:null},offset:0,grants:[{id:'grant',missionaryId:'m',missionaryCode:'M-02',memberCode:'U-FICTIONAL',requestId:null,expiresAt:new Date('2030-01-01'),revokedAt:null}]}));
  expect(html).toContain('data-label="有效期限"');expect(html).toContain('table-value table-nowrap');expect(html).toContain('data-label="操作"');expect(html).toContain('撤銷權限');
  expectAccessibleTable(html);
});
it('gives action cells explicit roles and real-text labels',()=>{
  const html=renderToStaticMarkup(createElement(DataTable,{kind:'access-requests',items:[{id:'fictional'}],actions:()=>createElement('button',null,'核准')}));
  expectAccessibleTable(html);
  expect(html).toContain('<td role="cell" data-label="操作"><span class="table-label">操作</span>');
});
