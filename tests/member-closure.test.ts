import {it,expect} from 'vitest';
import {ClientError} from '../src/ui/shared';
it('closed-account login errors explain the next step without real contact details',()=>{
  const error=new ClientError('account_disabled','fictional-reference');
  expect(error.message).toContain('帳號已關閉');
  expect(error.message).toContain('再次使用');
  expect(error.message).toContain('教會辦公室或關懷團隊');
  expect(error.message).not.toMatch(/https?:|@|\d{8,}/);
});
