import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const css=readFileSync('src/app/globals.css','utf8');
function luminance(hex:string) {
  const [r,g,b]=hex.match(/[a-f\d]{2}/gi)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
}
it('member helper text is 16px, footer is 14px and muted text meets AA on member surfaces',()=>{
  expect(css).toMatch(/\.member-shell :is\(p, small, label,[^}]*font-size: 16px;/);
  expect(css).toMatch(/\.member-shell \.member-footer small\s*\{\s*font-size: 14px;/);
  const color=css.match(/\.member-shell\s*\{\s*--muted: (#[a-f\d]{6});/)![1];
  for(const background of ['#ffffff','#fffdf8','#f6f6f1','#edf1e5']) expect((luminance(background)+.05)/(luminance(color)+.05)).toBeGreaterThanOrEqual(4.5);
});
it('the complete member shell reserves bottom navigation and device safe-area space',()=>{
  expect(css).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.member-shell\s*\{\s*padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\);/);
});
