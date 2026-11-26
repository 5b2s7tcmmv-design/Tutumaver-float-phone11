import {loadChatSessions,loadChatMessages} from "./chat-storage";
import {loadPhoneState} from "./phone-storage";
import {loadSms} from "./sms-storage";
/** Only actual outgoing replies and completed call records. No delivered-only message, private content, or user identity. */
export function liveInteractionHints(characterId:string,start:number,end:number){
 const events:{at:number;type:string}[]=[];
 for(const session of loadChatSessions()){
  for(const m of loadChatMessages(session.id,60)){
   const at=Date.parse(m.createdAt);if(at<start||at>end||m.role!=="assistant"||m.isRetracted||(m.senderCharacterId||session.contactId)!==characterId||m.origin&&m.origin!=="chat")continue;
   events.push({at,type:m.mediaType==="voice_call"||m.mediaType==="video_call"?"发生过Chat通话相关互动":"实际发出了Chat回复"});
  }
 }
 const sms=loadSms();
 const ids=new Set(sms.threads.filter(t=>t.characterId===characterId).map(t=>t.id));
 for(const m of sms.messages)if(ids.has(m.threadId)&&m.direction==="incoming"&&m.delivered&&m.createdAt>=start&&m.createdAt<=end)events.push({at:m.createdAt,type:"实际回复了短信"});
 for(const c of loadPhoneState().calls)if(c.characterId===characterId&&c.status==="completed"&&c.connectedAt!==undefined&&c.connectedAt<=end&&c.endedAt>=start)events.push({at:Math.max(start,c.connectedAt),type:"实际接通了电话"});
 const groups=new Map<string,number>();
 for(const e of events.sort((a,b)=>a.at-b.at)){const key=e.type;if(!groups.has(key))groups.set(key,e.at);}
 return [...groups].map(([type,at])=>new Date(at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})+" "+type).join("；");
}
