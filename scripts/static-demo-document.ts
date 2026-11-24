export type DemoDocumentOptions={file:string;routes:Record<string,string>;assets:Record<string,string>};

// This function runs in Chromium, on a clone rather than the live React tree.
export function staticDemoDocument(options:DemoDocumentOptions) {
  const root=document.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll('.env-badge').forEach(el=>el.textContent='DEMO · 展示版');
  const parents=options.file.split('/').slice(0,-1).map(()=>'..').join('/');
  const prefix=parents?parents+'/':'';
  const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
  root.querySelectorAll('script,base,iframe,object,embed,template,link:not([rel="stylesheet"]),meta[http-equiv],input[type="hidden"]').forEach(el=>el.remove());
  for(const el of root.querySelectorAll('*')) {
    for(const attr of [...el.attributes]) {
      if(/^on/i.test(attr.name)||['action','formaction','srcdoc','srcset','nonce','integrity','autofocus','ping'].includes(attr.name)) el.removeAttribute(attr.name);
      else if(!['href','src'].includes(attr.name)) el.setAttribute(attr.name,attr.value.replace(uuid,'展示資料'));
    }
  }
  for(const el of root.querySelectorAll('form,input,button,select,textarea,fieldset')) {
    el.setAttribute('disabled','');el.setAttribute('aria-disabled','true');
    if(el instanceof HTMLInputElement&&el.type==='password') el.value='';
  }
  root.querySelectorAll('[contenteditable]').forEach(el=>el.setAttribute('contenteditable','false'));
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) walker.currentNode.textContent=walker.currentNode.textContent?.replace(uuid,'展示資料')??'';
  for(const anchor of root.querySelectorAll('a[href]')) {
    const raw=anchor.getAttribute('href')!;
    if(raw.startsWith('#')) continue;
    const url=new URL(raw,location.href);
    const target=url.origin===location.origin?options.routes[url.pathname+url.search]:undefined;
    anchor.setAttribute('href',prefix+(target??'unavailable/index.html')+(target?url.hash:''));
    anchor.removeAttribute('target');anchor.removeAttribute('download');
  }
  for(const el of root.querySelectorAll('img[src],link[rel="stylesheet"]')) {
    const attr=el.tagName==='LINK'?'href':'src';const source=new URL(el.getAttribute(attr)!,location.href).href;
    const asset=options.assets[source];
    if(!asset) throw Error('Uncaptured static asset');
    el.setAttribute(attr,prefix+asset);
  }
  const style=document.createElement('link');style.rel='stylesheet';style.href=prefix+'assets/demo.css';root.querySelector('head')!.append(style);
  const csp=document.createElement('meta');csp.httpEquiv='Content-Security-Policy';
  csp.content="default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  root.querySelector('head')!.prepend(csp);
  const banner=document.createElement('aside');banner.className='demo-banner';banner.setAttribute('aria-label','展示版說明');
  const title=document.createElement('strong');title.textContent='展示版・全部為虛構資料・無法登入、無法儲存';banner.append(title);
  const nav=document.createElement('nav');nav.setAttribute('aria-label','展示版導覽');
  for(const [label,file] of [['展示入口','index.html'],['會友平台','member/app/index.html'],['管理角色','admin/index.html']]) {
    const link=document.createElement('a');link.setAttribute('href',prefix+file);link.textContent=label;nav.append(link);
  }
  banner.append(nav);root.querySelector('body')!.prepend(banner);
  return '<!doctype html>\n'+root.outerHTML;
}
