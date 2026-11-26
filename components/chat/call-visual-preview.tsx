"use client";
import {useEffect,useRef,useState} from "react";
import {Phone,Video} from "lucide-react";
import {loadChatSessions,getActiveChatSessionId,type ChatSession} from "@/lib/chat-storage";
import {loadCharacters} from "@/lib/character-storage";
import {resolveChatCharacterAvatar} from "@/lib/chat-profile-storage";
import {chatContactDisplayName} from "@/lib/communication-display-name";
import {resolveUserIdentity} from "@/lib/settings-storage";
import {callVisualStyle,useCallSessionVisual,useCallAsset,type CallVisualKind,type CallVisualGroup} from "@/lib/chat-call-appearance";
import {useChatUserAvatar,useGlobalCallAppearance} from "./use-chat-user-avatar";
import {VoiceCallLayout,type VoiceCallLine} from "./voice-call-layout";
import {Call039LineView,type Call039Line} from "./call039-shared-ui";
import {VideoCallBackdrop,VideoCallSelfPicture,VideoCallInfo,VideoConnectedComposer,VideoConnectedButtons} from "./call-visual-shared";
const noop=()=>{};
const voiceLines:VoiceCallLine[]=[
  {id:"preview-other",role:"assistant",text:"这是一段通话内容。"},
  {id:"preview-my",role:"user",text:"这是一段回应。"},
  {id:"preview-long",role:"assistant",text:"这是一段较长的通话内容，用于预览文字换行和显示效果。"},
];
function PreviewSurface({kind,group,session}:{kind:CallVisualKind;group:CallVisualGroup;session?:ChatSession}){
  const assets=useCallSessionVisual(session), globalAppearance=useGlobalCallAppearance();
  const background=useCallAsset(kind==="voice"?assets.voiceBackground:assets.videoBackground);
  const appearance=useCallAsset(assets.callAppearance||globalAppearance);
  const myAvatar=useChatUserAvatar(session)||"";
  const character=session?loadCharacters().find(c=>c.id===session.contactId):undefined;
  const avatar=character?resolveChatCharacterAvatar(character)||"":"";
  const name=character&&session?chatContactDisplayName(character.id,session):"对方";
  const myName=(session?resolveUserIdentity(session.contactId,"chat"):resolveUserIdentity())?.name||"我方";
  const style=callVisualStyle(kind,group);
  if(kind==="voice") return <div className="absolute inset-0 overflow-hidden voicecall-dark voicecall-cards" data-call-visual={group.enabled?"voice":undefined} style={group.enabled?style:background?{background:`url(${background}) center/cover no-repeat`}:{}}>
    {group.enabled&&background&&<div className="chat-call-visual-background" aria-hidden="true" style={{backgroundImage:`url(${background})`}}/>}
    <VoiceCallLayout name={name} avatar={avatar} userName={myName} userAvatar={myAvatar} lines={voiceLines} roundStart={null} playingId={null} state="IDLE" duration="00:32" queued={0} error={null} onClearError={noop} onMinimize={noop} onSummon={noop} onInput={noop} onHangup={noop} incoming={false} onAccept={noop} onDecline={noop} onPlay={noop} onFavorite={noop} onRetry={noop} onDelete={noop} onOutput={noop} outputName="播放设备" input={null} settings={null}/>
  </div>;
  const lines:Call039Line[]=[
    {id:"preview-other",role:"assistant",kind:"speech",speakerName:name,text:"这是一段通话内容。"},
    {id:"preview-action",role:"assistant",kind:"action",text:"这是一段动作描述。"},
    {id:"preview-my",role:"user",kind:"speech",speakerName:myName,text:"这是一段回应。"},
    {id:"preview-long",role:"assistant",kind:"speech",speakerName:name,text:"这是一段较长的通话内容，用于预览文字换行和显示效果。"},
  ];
  return <div className="absolute inset-0 flex flex-col bg-black text-white overflow-hidden call-keyboard-shift videocall-redesign" data-call-visual={group.enabled?"video":undefined} style={style}>
    <VideoCallBackdrop background={background} avatar={avatar}/><VideoCallSelfPicture src={appearance||myAvatar} name={myName}/><VideoCallInfo name={name} label="00:32 · 通话中"/>
    <div className="call039-video-overlay"><div className="call039-transcript">{lines.map(line=><Call039LineView key={line.id} line={line} showSpeaker onPlay={noop} onMenu={noop}/>)}</div></div>
    <VideoConnectedComposer kind="speech" draft="" busy={false} onKind={noop} onDraft={noop} onSend={noop} onSummon={noop}/>
    <div className="call039-video-controls"><VideoConnectedButtons camera={false} visible onCamera={noop} onHangup={noop} onVisibility={noop}/></div>
  </div>;
}
export function CallVisualPreview({kind,group}:{kind:CallVisualKind;group:CallVisualGroup}){
  const sessions=loadChatSessions().filter(s=>!s.isGroup).slice().sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  const [selected,setSelected]=useState(()=>sessions.find(s=>s.id===getActiveChatSessionId())?.id||sessions[0]?.id||"");
  const session=sessions.find(s=>s.id===selected);
  const host=useRef<HTMLDivElement>(null);
  const [frame,setFrame]=useState({w:360,h:720,scale:.5});
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const measure=()=>{const shell=el.closest<HTMLElement>(".phone-shell");const w=shell?.clientWidth||360,h=shell?.clientHeight||720;const scale=Math.min(el.clientWidth/w,el.clientHeight/h);if(scale>0)setFrame({w,h,scale});};
    measure();const ro=new ResizeObserver(measure);ro.observe(el);const shell=el.closest<HTMLElement>(".phone-shell");if(shell)ro.observe(shell);return()=>ro.disconnect();
  },[]);
  return <section className="call-visual-preview" aria-label={kind==="voice"?"语音通话预览":"视频通话预览"}>
    <div className="call-visual-preview-head">{kind==="voice"?<Phone size={16}/>:<Video size={16}/>}<strong>实时预览</strong><select aria-label="预览角色" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">默认示例</option>{sessions.map(s=>{const c=loadCharacters().find(c=>c.id===s.contactId);return <option value={s.id} key={s.id}>{c?chatContactDisplayName(c.id,s):s.alias||"角色"}</option>})}</select></div>
    <div ref={host} className="call-visual-preview-viewport"><div ref={el=>{if(el)el.setAttribute("inert","");}} className="call-visual-preview-frame" aria-hidden="true" style={{width:frame.w,height:frame.h,transform:`translate(-50%,-50%) scale(${frame.scale})`}}><PreviewSurface kind={kind} group={group} session={session}/></div></div>
    <p className="call-visual-preview-note">本地示例 · 不发起通话、不调用 API</p>
  </section>;
}
