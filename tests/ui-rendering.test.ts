import { it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatDate } from '../src/ui/shared';
import { AdminLetter } from '../src/ui/admin-panels';
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
