import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberPrivacy,MemberMissionary} from '../src/ui/member';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn(),replace:vi.fn()})}));
it('member explanations use ordinary language for following, reading access and private prayer totals',()=>{
  const privacy=renderToStaticMarkup(createElement(MemberPrivacy,{authenticated:false}));
  expect(privacy).toContain('每天只記一次，只顯示大約人數，不公開是誰');
  expect(privacy).not.toMatch(/每日去重|經隱私抑制/);
  const missionary=renderToStaticMarkup(createElement(MemberMissionary,{value:{id:'fictional',code:'M-01',region:'泛化地區',overview:null,governance:'public',following:false,pushOptIn:false,letters:[]}}));
  expect(missionary).toContain('不會傳送 LINE 訊息');
  expect(missionary).toContain('申請或更新閱讀權限');
  expect(missionary).not.toMatch(/觀看授權|不等於開啟推播/);
});
