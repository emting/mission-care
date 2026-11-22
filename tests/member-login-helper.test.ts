import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberLogin} from '../src/ui/member';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn(),replace:vi.fn()})}));
it('disabled member sign-in has a nearby accessible consent explanation',()=>{
  const html=renderToStaticMarkup(createElement(MemberLogin,{devEnabled:true}));
  expect(html).toContain('id="consent-helper"');
  expect(html).toContain('請先勾選上方的資料使用說明');
  expect(html).toMatch(/<button[^>]*aria-describedby="consent-helper"[^>]*disabled=""/);
});
