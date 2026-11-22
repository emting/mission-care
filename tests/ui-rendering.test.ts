import { it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatDate } from '../src/ui/shared';
import { AdminLetter, AdminSecurity } from '../src/ui/admin-panels';
import { AdminOverview } from '../src/ui/admin';
import { content } from './workflow-fixture';

vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn(),replace:vi.fn()})}));

it('SSR and browser timestamps use fixed zero-padded Taipei text without locale whitespace',()=>{
  expect(formatDate('2026-11-21T16:05:00Z')).toBe('2026/11/22 00:05');
  expect(formatDate(new Date('2026-01-01T00:09:00Z'))).toBe('2026/01/01 08:09');
  expect(formatDate('2025-12-31T16:00:00Z')).toBe('2026/01/01 00:00');
  expect(formatDate(null)).toBe('尚無紀錄');
  expect(formatDate(undefined)).toBe('尚無紀錄');
  expect(formatDate('invalid')).toBe('尚無紀錄');
});

it('an author without review permission sees a disabled approve control and self-approval explanation',()=>{
  const value:Parameters<typeof AdminLetter>[0]['value']={
    id:'fictional-letter',missionaryId:'fictional-missionary',revision:1,status:'pending_review',consent:false,
    content,suggestion:null,riskFlags:[],self:true,reviewed:false,taskId:null,
    canEdit:true,canSubmit:true,canReview:false,canPublish:false,canArchive:false,reviews:[],
  };
  const html=renderToStaticMarkup(createElement(AdminLetter,{value}));
  expect(html).toContain('不可自行核准');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>核准此版本<\/button>/);
});

it('overview cards distinguish authorized empty, unauthorized, unavailable and actionable sources',()=>{
  const html=renderToStaticMarkup(createElement(AdminOverview,{value:{
    as_of:'2026-11-21T16:05:00Z',tasks:{status:'available',count:0},
    access_requests:{status:'not_authorized'},notification_jobs:{status:'unavailable'},incidents:{status:'available',count:3},
  }}));
  const cards=[...html.matchAll(/<section class="panel metric-card">(.*?)<\/section>/g)].map(m=>m[1]);
  expect(cards).toHaveLength(4);
  expect(cards[0]).toContain('目前沒有待處理項目');
  expect(cards[0]).not.toContain('<a');
  expect(cards[0]).not.toContain('目前無授權可見資料');
  expect(cards[1]).toContain('目前無授權可見資料');
  expect(cards[1]).not.toContain('<a');
  expect(cards[2]).toContain('資料暫不可用');
  expect(cards[2]).not.toContain('<a');
  expect(cards[3]).toContain('3<small>件');
  expect(cards[3]).toContain('前往處理');
  expect(html).not.toContain('href="/admin/tasks"');
});

it('lockdown starts with an empty required reason and a disabled submit button',()=>{
  const html=renderToStaticMarkup(createElement(AdminSecurity,{canLockdown:true,incidents:{items:[],count:0,next_offset:null}}));
  expect(html).toMatch(/<select name="reasonCode" required=""><option value="" disabled="" selected="">請選擇處置原因<\/option>/);
  expect(html).toMatch(/<button class="danger" disabled="">確認執行安全處置<\/button>/);
});
