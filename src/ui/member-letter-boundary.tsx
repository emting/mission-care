"use client";
import {useEffect,useRef,useState} from "react";
import {api,ClientError,Feedback} from "./shared";

export function MemberLetterBoundary({id,children}:{id:string;children:React.ReactNode}) {
  const [state,setState]=useState<"checking"|"ready"|"missing"|"error">("checking");
  const [error,setError]=useState<ClientError|null>(null);
  const content=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let active=true, generation=0;
    const hide=()=>{
      generation++;
      if(content.current) content.current.hidden=true;
      setState("checking");
    };
    const check=async()=>{
      hide();
      const current=generation;
      try {
        await api("letters/"+id);
        if(active && current===generation) setState("ready");
      } catch(cause) {
        if(!active || current!==generation) return;
        const failure=cause instanceof ClientError?cause:new ClientError("network_error","無法取得");
        setError(failure);
        setState(["not_found","unauthenticated","forbidden","account_disabled"].includes(failure.code)?"missing":"error");
      }
    };
    const show=(event:PageTransitionEvent)=>{if(event.persisted) void check();};
    const visibility=()=>{if(document.visibilityState==="hidden") hide(); else void check();};
    window.addEventListener("pagehide",hide);
    window.addEventListener("pageshow",show);
    window.addEventListener("popstate",check);
    document.addEventListener("visibilitychange",visibility);
    void check();
    return ()=>{
      active=false; generation++;
      if(content.current) content.current.hidden=true;
      window.removeEventListener("pagehide",hide);
      window.removeEventListener("pageshow",show);
      window.removeEventListener("popstate",check);
      document.removeEventListener("visibilitychange",visibility);
    };
  },[id]);
  return <>
    {state==="checking" && <p role="status">正在確認閱讀權限…</p>}
    {state==="missing" && <section className="panel error-state" role="alert">
      <span className="eyebrow">404 · 無法顯示</span>
      <h1>目前無法閱讀此內容</h1>
      <p>內容可能已撤回、尚未發布，或不在目前閱讀權限範圍內。</p>
      <a className="button" href="/app">返回關懷平台</a>
    </section>}
    {state==="error" && <><Feedback member value={{ok:false,text:"暫時無法確認閱讀權限，請重新整理後再試。",id:error?.requestId??"無法取得"}} /><a href={"/app/letters/"+id}>重新確認閱讀權限</a></>}
    <div ref={content} hidden={state!=="ready"}>{state==="ready"?children:null}</div>
  </>;
}
