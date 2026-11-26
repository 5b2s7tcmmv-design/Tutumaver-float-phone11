"use client";
import type {ReactNode} from "react";
import {Video,VideoOff,PhoneOff,MessageSquare,MessageSquareOff} from "lucide-react";
import type {Call039ComposeKind} from "./call039-shared-ui";

/** Presentation only: used by both the connected screen and the offline preview. */
export function VideoCallBackdrop({background,avatar}:{background?:string|null;avatar?:string|null}){
  return <div className="videocall-bg-blur" style={{backgroundImage:background?`url(${background})`:avatar?`url(${avatar})`:"linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)"}}/>;
}
export function VideoCallSelfPicture({src,name,children}:{src?:string|null;name:string;children?:ReactNode}){
  return <div className="videocall-self-cam" aria-label="我的通话画面">{children || (src?<img src={src} alt={name} className="w-full h-full object-cover"/>:<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>)}</div>;
}
export function VideoCallInfo({name,label,animated=false}:{name:string;label:string;animated?:boolean}){
  return <div className="relative z-10 gcall-topbar gcall-topbar-video"><div className="gcall-topbar-title videocall-name">{name}</div><div className="gcall-topbar-sub videocall-name" {...(animated?{"data-anim":""}:{})}>{label}</div></div>;
}
export function VideoConnectedComposer({kind,draft,busy,onKind,onDraft,onSend,onSummon}:{kind:Call039ComposeKind;draft:string;busy:boolean;onKind:()=>void;onDraft:(value:string)=>void;onSend:()=>void;onSummon:()=>void}){
  return <div className="call039-voice-compose"><button type="button" className="call039-kind" onClick={onKind} aria-label="切换语言和动作">{kind==="speech"?"语":"动"}</button><input value={draft} onChange={e=>onDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing&&!e.shiftKey){e.preventDefault();onSend();}}} placeholder={kind==="speech"?"输入你想说的话，回车发送…":"输入动作，回车发送…"} disabled={busy}/><button type="button" onClick={onSummon} disabled={busy} aria-label="召唤角色继续">↑</button></div>;
}
export function VideoConnectedButtons({camera,visible,onCamera,onHangup,onVisibility}:{camera:boolean;visible:boolean;onCamera:()=>void;onHangup:()=>void;onVisibility:()=>void}){
  return <><button type="button" onClick={onCamera} aria-label={camera?"关闭摄像头":"打开摄像头"}>{camera?<Video size={24}/>:<VideoOff size={24}/>}</button><button type="button" className="hang" onClick={onHangup} aria-label="挂断"><PhoneOff size={28}/></button><button type="button" onClick={onVisibility} aria-label={visible?"隐藏对话和输入":"显示对话和输入"}>{visible?<MessageSquare size={24}/>:<MessageSquareOff size={24}/>}</button></>;
}
