import { it, expect } from 'vitest';
import { formatDate } from '../src/ui/shared';

it('SSR and browser timestamps use fixed zero-padded Taipei text without locale whitespace',()=>{
  expect(formatDate('2026-11-21T16:05:00Z')).toBe('2026/11/22 00:05');
  expect(formatDate(new Date('2026-01-01T00:09:00Z'))).toBe('2026/01/01 08:09');
  expect(formatDate('2025-12-31T16:00:00Z')).toBe('2026/01/01 00:00');
  expect(formatDate(null)).toBe('尚無紀錄');
  expect(formatDate(undefined)).toBe('尚無紀錄');
  expect(formatDate('invalid')).toBe('尚無紀錄');
});
