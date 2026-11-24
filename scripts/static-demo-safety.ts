import {posix} from 'node:path';

export function demoFile(scope:string,route:string) {
  const url=new URL(route,'https://demo.invalid');
  const path=url.pathname==='/'?'':url.pathname;
  const tab=url.searchParams.get('tab');
  return `${scope}${path}${tab?'/'+tab:''}/index.html`;
}

export function relativeDemoPath(from:string,to:string) {
  return posix.relative(posix.dirname(from),to)||'index.html';
}

export function assertDemoReferences(files:{name:string;bytes:Buffer}[]) {
  const names=new Set(files.map(file=>file.name));
  for(const file of files) {
    if(!/\.(?:html|css)$/.test(file.name)) continue;
    const text=file.bytes.toString();
    const links=file.name.endsWith('.html')?[...text.matchAll(/\b(?:href|src)="([^"]+)"/g)]:[...text.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)];
    for(const [,link] of links) {
      if(link.startsWith('data:')) continue;
      const url=new URL(link,'https://demo.invalid/'+file.name);
      if(url.origin!=='https://demo.invalid'||!names.has(decodeURIComponent(url.pathname.slice(1))))
        throw Error(`Static demo has an uncaptured link/asset in ${file.name}`);
    }
  }
}

export function assertSafeDemo(files:{name:string;bytes:Buffer}[],secrets:string[]) {
  const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  for(const file of files) {
    if(secrets.filter(Boolean).some(secret=>file.bytes.includes(Buffer.from(secret))))
      throw Error(`Static demo safety check failed: credential/session value in ${file.name}`);
    if(!/\.(?:html|css|svg|json|txt)$/i.test(file.name)) continue;
    const text=file.bytes.toString('utf8');
    if(text.includes('PROD')) throw Error(`Static demo safety check failed: production label in ${file.name}`);
    if(/\bU[0-9a-f]{32}\b/i.test(text)||/__Host-mc_|set-cookie|tokenHash|totpSecret|encryptedSub/i.test(text))
      throw Error(`Static demo safety check failed: identity/session metadata in ${file.name}`);
    const withoutPaths=text.replace(/\b(?:href|src)="[^"]*"/g,'');
    if(uuid.test(withoutPaths)) throw Error(`Static demo safety check failed: request/session UUID in ${file.name}`);
    if(file.name.endsWith('.html')&&(/<script\b|\son\w+\s*=|\s(?:action|formaction|srcdoc)\s*=/i.test(text)))
      throw Error(`Static demo safety check failed: active content in ${file.name}`);
    if(file.name.endsWith('.html')) {
      for(const tag of text.match(/<(?:form|input|button|select|textarea|fieldset)\b[^>]*>/gi)??[])
        if(!/\sdisabled(?:[\s=>])/i.test(tag)) throw Error(`Static demo safety check failed: enabled control in ${file.name}`);
      for(const [,href] of text.matchAll(/\bhref="([^"]*)"/g))
        if(/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(href)) throw Error(`Static demo safety check failed: nonrelative link in ${file.name}`);
    }
  }
}
