import {kvGet} from "./kv-db";
import {loadCharacters} from "./character-storage";
import {loadOwnerCalendarPlans} from "./calendar-storage";
import {formatZonedPromptTimestamp,getSystemTimeZone} from "./character-time";
import type {CalendarScheduleItem} from "./calendar-types";
import type {WeverseState,WeverseLive} from "./weverse-storage";

export type LivePlatform="weverse";
export type ScheduledLive={id:string;platform:LivePlatform;characterId:string;start:number;end:number;level:1|2|3|4;title:string;item:CalendarScheduleItem};
function read<T>(key:string):Partial<T>{try{return JSON.parse(kvGet(key)||"{}")}catch{return {}}}
function wallAt(stamp:number,zone:string){
 let result=stamp;
 for(let i=0;i<4;i++){const actual=Date.parse(formatZonedPromptTimestamp(new Date(result),zone).replace(" ","T")+":00Z");if(!Number.isFinite(actual))return NaN;const delta=stamp-actual;if(!delta)break;result+=delta;}
 return result;
}
export function livePlatform(item:CalendarScheduleItem):LivePlatform|undefined{
 const t=[item.title,item.location,item.contentDescription].filter(Boolean).join(" ");
 if(!/直播|陪看|\blive\b/i.test(t))return;
 const yt=/youtube|油管|优兔/i.test(t),wvs=/weverse|\bwvs\b/i.test(t)||item.externalSource==="weverse";
 if(yt)return;if(wvs)return "weverse";
 if(/回归|新剧|首集|作品|新歌|发布|宣传|倒计时/.test(item.title))return "weverse";
}
export function scheduledLives(characterId:string,now=Date.now()):ScheduledLive[]{
 const char=loadCharacters().find(c=>c.id===characterId);if(!char)return [];
 const zone=char.timeZone||getSystemTimeZone();
 return loadOwnerCalendarPlans("character",characterId).flatMap(p=>p.items).flatMap(item=>{
  if(item.kind==="milestone")return [];
  const platform=livePlatform(item);if(!platform)return [];
  const a=Date.parse(item.date+"T"+item.startTime+":00Z"),b=Date.parse(item.date+"T"+item.endTime+":00Z");if(!Number.isFinite(a)||!Number.isFinite(b))return [];
  const start=wallAt(a,zone),end=wallAt(b<=a?b+86400000:b,zone);
  if(!(start<=now&&now<end))return [];
  const id=platform+":"+(item.sharedGroupId||item.externalId||characterId+":"+item.id);
  return [{id,platform,characterId,start,end,level:item.busyLevel??(item.source==="manual"?1:4),title:item.title,item}];
 }).sort((a,b)=>b.level-a.level||a.start-b.start||a.id.localeCompare(b.id));
}
export function liveActivity(characterId:string,now=Date.now(),ignoreId?:string){
 const wv=read<WeverseState>("ai_phone_weverse_state_v1");

 const w=(wv.lives||[]).find(l=>l.id!==ignoreId&&!l.official&&l.status==="live"&&l.startedAt<=now&&(!l.endedAt||now<l.endedAt)&&(!l.scheduledEndAt||now<l.scheduledEndAt)&&(l.activeCharacterIds||[]).includes(characterId));
 if(w)return {platform:"weverse" as const,id:w.id,start:w.startedAt,end:w.endedAt??w.scheduledEndAt,title:w.title,level:scheduledLives(characterId,now).find(p=>p.platform==="weverse")?.level??2,wvs:w};
 const plan=scheduledLives(characterId,now).find(p=>(wv.communities||[]).some(c=>c.memberCharacterIds.includes(characterId))&&!(wv.lives||[]).some(l=>l.scheduleId===p.id));
 return plan?{platform:plan.platform,id:plan.id,start:plan.start,end:plan.end,title:plan.title,level:plan.level,wvs:undefined}:undefined;
}
export function activeLivePrompt(characterId:string,now=Date.now()){
 const a=liveActivity(characterId,now);if(!a)return "";
 let lines:string[]=[];
 if(a.wvs){
  const spans=(a.wvs.participantPresence||[]).filter(p=>p.characterId===characterId);
  lines=a.wvs.segments.filter(l=>l.createdAt<=now&&l.kind!=="system"&&spans.some(s=>s.joinedAt<=l.createdAt&&l.createdAt<=(s.leftAt??now))).slice(-6).map(l=>l.original);
 }
 return "【本人当前直播活动｜临时状态，不是历史记忆】"+"Weverse"+"《"+a.title+"》，已开播约"+Math.max(0,Math.floor((now-a.start)/60000))+"分钟；日程可联系等级 "+a.level+"/4。按日程等级、现场情况和本人性格决定是否看手机、回复或接电话。不是一律拒绝。不得把私聊内容在直播中公开。"+(lines.length?"\n本人实际在场且已播出的片段：\n"+lines.join("\n"):"\n当前没有可读取的已播出片段，不能编造具体直播内容。");
}
export function isLiveInteractionApp(appId:string,tags:string[]=[]){
 return ["chat","group_chat","phone","sms","voice_call","video_call","chat_voice_call","chat_video_call","call"].includes(appId)&&!tags.some(t=>/offline|story|reading|adventure/.test(t));
}
