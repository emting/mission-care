import {it,expect} from 'vitest';
import sharp from 'sharp';
import {fixture,s,eq,randomUUID} from './workflow-fixture';

it('authorizes media independently for each cookie without combining permissions',async()=>{
  const f=await fixture();
  try {
    const letter=await f.draft();
    const image=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).webp().toBuffer();
    const asset=await f.media.upload(f.editor.token,letter.id,1,image,randomUUID());
    const read=async(admin?:string,member:string='')=>{
      const response=await f.route(f.request('media/'+asset.id,undefined,admin,member));
      expect(response.headers.get('cache-control')).toBe('no-store');
      return response;
    };
    expect((await read(f.owner.token,f.member)).status).toBe(404);
    expect((await read(f.editor.token)).status).toBe(200);
    await f.approved(letter.id,2);
    await f.editorial.publish(f.lead.token,letter.id,2,randomUUID());
    const shared=await read(f.owner.token,f.member);
    expect(shared.status).toBe(200);
    expect(shared.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await shared.arrayBuffer()).length).toBeGreaterThan(0);
    const [audit]=await f.db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId,shared.headers.get('x-request-id')!));
    expect(audit.actorId).toBe(f.user.id);
    expect((await f.route(f.request(`letters/${letter.id}/prayer-stats`,undefined,f.owner.token))).status).toBe(200);
    expect((await read(undefined,f.member)).status).toBe(200);
    expect((await read(f.editor.token)).status).toBe(200);
    expect((await read(f.owner.token)).status).toBe(404);
    expect((await read('invalid-admin',f.member)).status).toBe(200);
    expect((await read(f.editor.token,'invalid-member')).status).toBe(200);
    await f.db.update(s.letterAssets).set({reviewedAt:null}).where(eq(s.letterAssets.id,asset.id));
    expect((await read(f.owner.token,f.member)).status).toBe(404);
    expect((await read(f.editor.token,f.member)).status).toBe(200);
    await f.db.update(s.letterAssets).set({reviewedAt:f.clock.now}).where(eq(s.letterAssets.id,asset.id));
    await f.db.update(s.accessGrants).set({revokedAt:f.clock.now}).where(eq(s.accessGrants.id,f.grant.id));
    expect((await read(f.owner.token,f.member)).status).toBe(404);
    expect((await read(undefined,f.member)).status).toBe(404);
    expect((await read(f.editor.token,f.member)).status).toBe(200);
    const otherScope=await f.staff(['editor'],f.b.id);
    expect((await read(otherScope.token,f.member)).status).toBe(404);
    expect((await read('invalid-admin','invalid-member')).status).toBe(404);
    expect((await read()).status).toBe(404);
    const missing=await f.route(f.request('media/'+randomUUID(),undefined,f.owner.token));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  } finally {await f.pg.close();}
});
