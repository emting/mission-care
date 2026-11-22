import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Feedback} from '../src/ui/shared';
it('member success has no technical IDs, errors have only one short reference, admin retains labelled receipts',()=>{
  const value={ok:true,text:'已完成',id:'12345678-1234-4000-8000-000000000001',httpId:'87654321-1234-4000-8000-000000000001'};
  const success=renderToStaticMarkup(createElement(Feedback,{value,member:true}));
  expect(success).toContain('已完成');
  expect(success).not.toMatch(/12345678|87654321|request_id|參考編號/);
  const error=renderToStaticMarkup(createElement(Feedback,{value:{...value,ok:false},member:true}));
  expect(error).toContain('參考編號：12345678');
  expect(error).not.toMatch(/1234-4000|87654321|request_id/);
  expect((error.match(/參考編號/g)??[]).length).toBe(1);
  const admin=renderToStaticMarkup(createElement(Feedback,{value}));
  expect(admin).toContain('action_request_id：'+value.id);
  expect(admin).toContain('http_request_id：'+value.httpId);
  expect(renderToStaticMarkup(createElement(Feedback,{value:null,member:true}))).toBe('');
});
