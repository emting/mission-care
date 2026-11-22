import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberLetterBoundary} from '../src/ui/member-letter-boundary';
import {middleware} from '../src/middleware';
import config from '../next.config';
it('letter content is absent until fresh authorization succeeds, rather than trusting restored props',()=>{
  const html=renderToStaticMarkup(createElement(MemberLetterBoundary,{id:'fictional-letter',children:createElement('p',null,'fictional-private-letter-text')}));
  expect(html).toContain('正在確認閱讀權限');
  expect(html).not.toContain('fictional-private-letter-text');
});
it('member document/RSC responses disallow storage and client prefetch/router stale times are zero',()=>{
  expect(middleware().headers.get('Cache-Control')).toContain('no-store');
  expect(config.experimental?.staleTimes).toEqual({dynamic:0,static:0});
});
