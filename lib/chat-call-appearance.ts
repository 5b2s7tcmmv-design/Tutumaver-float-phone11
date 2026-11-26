"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { CHAT_APP_SETTINGS_UPDATED_EVENT, loadChatAppSettings, loadChatSessions, type ChatSession, type ChatAppSettings } from "@/lib/chat-storage";

export type CallVisualKind="video"|"voice";
export type CallVisualSurface={color:string;text:string;opacity:number;radius:number;shadow:number;shadowColor:string};
export type CallVisualConfig={blur:number;backgroundOpacity:number;my:CallVisualSurface;other:CallVisualSurface;input:CallVisualSurface;buttons:{color:string;text:string;opacity:number}};
export type CallVisualPreset={id:string;name:string;config:CallVisualConfig};
export type CallVisualGroup={enabled:boolean;config:CallVisualConfig;presets:CallVisualPreset[]};
export type CallVisualSettings=Partial<Record<CallVisualKind,CallVisualGroup>>;
const color=(v:unknown,f:string)=>typeof v==="string"&&/^#[0-9a-f]{6}$/i.test(v)?v:f;
const num=(v:unknown,f:number,max=100)=>typeof v==="number"&&Number.isFinite(v)?Math.min(max,Math.max(0,v)):f;
export function defaultCallVisual(kind:CallVisualKind):CallVisualConfig{
  const surface:CallVisualSurface=kind==="video"?{color:"#625d6a",text:"#ffffff",opacity:66,radius:16,shadow:25,shadowColor:"#000000"}:{color:"#252229",text:"#f5f4f6",opacity:93,radius:22,shadow:0,shadowColor:"#000000"};
  return {blur:kind==="video"?100:0,backgroundOpacity:100,my:{...surface},other:{...surface},input:{color:"#3b3744",text:"#ffffff",opacity:81,radius:25,shadow:0,shadowColor:"#000000"},buttons:{color:"#ffffff",text:"#ffffff",opacity:6}};
}
function surface(v:Partial<CallVisualSurface>|undefined,f:CallVisualSurface):CallVisualSurface{return {color:color(v?.color,f.color),text:color(v?.text,f.text),opacity:num(v?.opacity,f.opacity),radius:num(v?.radius,f.radius,36),shadow:num(v?.shadow,f.shadow),shadowColor:color(v?.shadowColor,f.shadowColor)};}
export function normalizeCallVisual(kind:CallVisualKind,v:Partial<CallVisualConfig>|undefined):CallVisualConfig{
  const f=defaultCallVisual(kind);
  return {blur:num(v?.blur,f.blur),backgroundOpacity:num(v?.backgroundOpacity,f.backgroundOpacity),my:surface(v?.my,f.my),other:surface(v?.other,f.other),input:surface(v?.input,f.input),buttons:{color:color(v?.buttons?.color,f.buttons.color),text:color(v?.buttons?.text,f.buttons.text),opacity:num(v?.buttons?.opacity,f.buttons.opacity)}};
}
export function readCallVisual(kind:CallVisualKind, settings:ChatAppSettings=loadChatAppSettings()):CallVisualGroup{
  const raw=settings.callVisualAppearance?.[kind];
  return {enabled:raw?.enabled===true,config:normalizeCallVisual(kind,raw?.config),presets:Array.isArray(raw?.presets)?raw.presets.filter(p=>p&&typeof p.id==="string"&&typeof p.name==="string").map(p=>({...p,config:normalizeCallVisual(kind,p.config)})):[]};
}
function alpha(hex:string,opacity:number){return hex+Math.round(opacity*255/100).toString(16).padStart(2,"0");}
export function callVisualStyle(kind:CallVisualKind,group:CallVisualGroup):CSSProperties{
  if(!group.enabled)return {};
  const c=group.config,vars:Record<string,string>={"--cv-bg-opacity":String(c.backgroundOpacity/100),"--cv-bg-blur":(c.blur*.18)+"px","--cv-bg-brightness":String(kind==="video"?1-.43*c.blur/100:1),"--cv-bg-scale":String(1+.15*c.blur/100),"--cv-button-bg":alpha(c.buttons.color,c.buttons.opacity),"--cv-button-text":c.buttons.text};
  for(const key of ["my","other","input"] as const){const x=c[key];vars["--cv-"+key+"-bg"]=alpha(x.color,x.opacity);vars["--cv-"+key+"-text"]=x.text;vars["--cv-"+key+"-radius"]=x.radius+"px";vars["--cv-"+key+"-shadow"]=x.shadow===0?"none":"0 4px 16px "+alpha(x.shadowColor,x.shadow);}
  return vars as CSSProperties;
}
export function useCallVisual(kind:CallVisualKind){
  const [group,setGroup]=useState(()=>readCallVisual(kind));
  useEffect(()=>{
    const sync=(event?:Event)=>{const detail=event?.type===CHAT_APP_SETTINGS_UPDATED_EVENT?(event as CustomEvent<ChatAppSettings>).detail:undefined;setGroup(readCallVisual(kind,detail||loadChatAppSettings()));};
    sync();window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT,sync);window.addEventListener("rabbit-app-visibility",sync);window.addEventListener("focus",sync);document.addEventListener("visibilitychange",sync);
    return()=>{window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT,sync);window.removeEventListener("rabbit-app-visibility",sync);window.removeEventListener("focus",sync);document.removeEventListener("visibilitychange",sync);};
  },[kind]);
  return {enabled:group.enabled,style:callVisualStyle(kind,group)};
}

type CallSessionVisual=Pick<ChatSession,"voiceBackground"|"videoBackground"|"callAppearance"|"groupVideoBackgrounds">;
/** Keep only presentation fields live; do not replace the session object used by the active call engine. */
export function useCallSessionVisual(session?:ChatSession):CallSessionVisual {
  const read=():CallSessionVisual=>{
    const latest=session ? loadChatSessions().find(s=>s.id===session.id)||session : undefined;
    return {voiceBackground:latest?.voiceBackground,videoBackground:latest?.videoBackground,callAppearance:latest?.callAppearance,groupVideoBackgrounds:latest?.groupVideoBackgrounds};
  };
  const [value,setValue]=useState(read);
  useEffect(()=>{
    const sync=()=>{const next=read();setValue(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);};
    sync();window.addEventListener("chat-sessions-updated",sync);window.addEventListener("rabbit-app-visibility",sync);window.addEventListener("focus",sync);
    return()=>{window.removeEventListener("chat-sessions-updated",sync);window.removeEventListener("rabbit-app-visibility",sync);window.removeEventListener("focus",sync);};
  },[session?.id,session?.voiceBackground,session?.videoBackground,session?.callAppearance,session?.groupVideoBackgrounds]);
  return value;
}
/** Asset-only resolver; cancellation prevents an older background replacing a newer choice. */
export function useCallAsset(reference?:string|null):string|null {
  const [resolved,setResolved]=useState<string|null>(()=>reference&&/^(data:|https?:|blob:)/i.test(reference)?reference:null);
  useEffect(()=>{
    let alive=true;
    if(!reference){setResolved(null);return;}
    if(/^(data:|https?:|blob:)/i.test(reference)){setResolved(reference);return;}
    setResolved(null);
    void import("@/lib/chat-asset-storage").then(({getChatImageFromIndexedDB})=>getChatImageFromIndexedDB(reference)).then(url=>{if(alive)setResolved(url||null);}).catch(()=>{if(alive)setResolved(null);});
    return()=>{alive=false;};
  },[reference]);
  return resolved;
}
