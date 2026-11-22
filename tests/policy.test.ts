import { describe,it,expect } from 'vitest';
import { canViewMissionary,canViewLetter,staffCan,canApprove,hasDualControl,recentMfa,permissions,type Role } from '../src/server/policy';
const now = new Date('2026-01-01T00:00:00Z');
const m = {id:'A',active:true,governance:'invite_only' as const};
const grant = {userId:'u',missionaryId:'A',expiresAt:new Date(+now+1000),revokedAt:null};
describe('member policy',()=>{
  it('defaults closed, including inactive and offline',()=>{
    expect(canViewMissionary('u',m,[],now)).toBe(false);
    expect(canViewMissionary(null,{...m,governance:'public'},[],now)).toBe(false);
    expect(canViewMissionary('u',{...m,active:false},[grant],now)).toBe(false);
    expect(canViewMissionary('u',{...m,governance:'offline'},[grant],now)).toBe(false);
  });
  it('requires exact active grant',()=>{
    expect(canViewMissionary('u',m,[grant],now)).toBe(true);
    for (const patch of [{userId:'v'},{missionaryId:'B'},{expiresAt:now},{revokedAt:now}]) expect(canViewMissionary('u',m,[{...grant,...patch}],now)).toBe(false);
  });
  it('only published, matching letters and restrictive effective policy',()=>{
    const l = {missionaryId:'A',status:'published',visibility:'public'};
    expect(canViewLetter('u',{...m,governance:'public'},l,[],now)).toBe(true);
    for (const status of ['draft','pending_review','approved','archived']) expect(canViewLetter('u',m,{...l,status},[grant],now)).toBe(false);
    expect(canViewLetter('u',m,{...l,missionaryId:'B'},[grant],now)).toBe(false);
    expect(canViewLetter('u',{...m,governance:'public'},{...l,visibility:'restricted'},[],now)).toBe(false);
  });
});
describe('staff default-deny matrix',()=>{
  for (const role of Object.keys(permissions) as Role[]) it(role,()=>{
    const a = {adminId:'a',role,missionaryId:'A',expiresAt:new Date(+now+1000),revokedAt:null};
    for (const p of new Set(Object.values(permissions).flat())) expect(staffCan('a',[a],p,'A',now)).toBe((permissions[role] as readonly string[]).includes(p));
    expect(staffCan('a',[a],'overview','B',now)).toBe(false);
    expect(staffCan('a',[{...a,expiresAt:now}],'overview','A',now)).toBe(false);
    expect(staffCan('a',[{...a,revokedAt:now}],'overview','A',now)).toBe(false);
    expect(staffCan('a',[],'overview','A',now)).toBe(false);
  });
  it('does not turn unscoped editor into a wildcard',()=> expect(staffCan('a',[{adminId:'a',role:'editor',missionaryId:null,expiresAt:new Date(+now+1000),revokedAt:null}],'draft_edit','B',now)).toBe(false));
  it('requires independent approvals and recent MFA',()=>{
    expect(canApprove('a','a')).toBe(false); expect(canApprove('a','b')).toBe(true);
    expect(hasDualControl('a',['a','b','b'])).toBe(false); expect(hasDualControl('a',['b','c'])).toBe(true); expect(hasDualControl('a',[])).toBe(false);
    expect(recentMfa(now,now)).toBe(true); expect(recentMfa(null,now)).toBe(false); expect(recentMfa(new Date(+now-300000),now)).toBe(false);
  });
});
