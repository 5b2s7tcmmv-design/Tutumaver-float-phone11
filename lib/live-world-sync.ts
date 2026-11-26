import {loadWeverseState,updateWeverseLive} from "./weverse-storage";
import {loadCharacters} from "./character-storage";
import {resolveUserIdentity} from "./settings-storage";
import {loadMemoryConfig} from "./memory-storage";
import {buildWeverseLiveMemory,weverseLiveFingerprint,splitWeverseLiveMemory,weverseLiveSummaryKey} from "./weverse-live-memory";
import {ensureLiveWorldEvent,loadWorldlineState,saveWorldlineState,type WorldlineEvent} from "./worldline-storage";
import {summarizeLiveText,type LivePlatform} from "./live-summary";

function publicMaterial(platform:LivePlatform,id:string){
 const characters=loadCharacters(),known=new Set(characters.map(c=>c.id));

 const state=loadWeverseState(),live=state.lives.find(l=>l.id===id&&l.status==="ended");
 if(!live||!live.endedAt)return;
 const community=state.communities.find(c=>c.id===live.communityId),end=live.endedAt;
 const name=(id:string)=>community?.memberProfiles?.[id]?.displayName|| (id.startsWith("user:")?"艺人":characters.find(c=>c.id===id)?.name||"艺人");
 const people=[...new Set([...live.participantPresence,...live.viewerPresence].filter(p=>p.joinedAt<=end).map(p=>p.characterId))].filter(x=>known.has(x));
 const lines=live.segments.filter(s=>s.createdAt<=end&&s.kind!=="system").map(s=>`${s.characterId?name(s.characterId):"艺人"} ${s.kind==="action"?"动作":"台词"}：${s.original}`);
 const comments=live.comments.filter(c=>c.createdAt<=end).map(c=>`观众 ${c.authorName}：${c.originalBody||c.body}`);
 return {worldId:live.worldId,title:live.title,start:live.startedAt,end,people,hasContent:lines.length+comments.length>0,text:[`社区：${community?.name||"Weverse"}；直播：${live.title}`,...lines,...comments].join("\n")};
}
const running=new Set<string>();
export async function syncLiveWorldEvent(platform:LivePlatform,id:string,force=false){
 const material=publicMaterial(platform,id);if(!material)return;
 const key=platform+":"+id;if(running.has(key))return;
 const event=ensureLiveWorldEvent(material.worldId,{platform,id,state:"pending"},{title:material.title,occurredAt:new Date(material.start).toISOString(),endsAt:new Date(material.end).toISOString(),people:Object.fromEntries(material.people.map(id=>[id,{access:"witnessed" as const,perspective:""}]))});
 if(!event||(!force&&event.liveSource?.state!=="pending"))return;
 running.add(key);
 try{
  if(!material.hasContent)return;
  const detail=await summarizeLiveText(platform,"public",material.text);
  if(!publicMaterial(platform,id))return;
  const state=loadWorldlineState(),current=state.worlds.flatMap(w=>w.events).find(e=>e.id===event.id);
  if(!current?.liveSource||current.detail!==event.detail||current.updatedAt!==event.updatedAt)return;
  const next:WorldlineEvent={...current,detail,liveSource:{...current.liveSource,state:"ready"},updatedAt:new Date().toISOString()};
  saveWorldlineState({...state,worlds:state.worlds.map(w=>({...w,events:w.events.map(e=>e.id===next.id?next:e)}))});
 }finally{running.delete(key);}
}

const runningWeverseSummaries=new Set<string>();
export async function summarizeWeverseLive(id:string,onlyCharacterId?:string){
 if(loadMemoryConfig().shortTermAllowedSources?.weverse===false)return;
 const state=loadWeverseState(),live=state.lives.find(l=>l.id===id&&l.status==="ended");
 if(!live||live.official)return;
 const characters=loadCharacters(),community=state.communities.find(c=>c.id===live.communityId);
 const names=(id:string)=>community?.memberProfiles?.[id]?.displayName|| (id.startsWith("user:")?resolveUserIdentity(undefined,"weverse")?.name||"用户":characters.find(c=>c.id===id)?.name||"艺人");
 const ids=[...new Set([...(live.participantPresence?.length?live.participantPresence.map(p=>p.characterId):live.hostCharacterIds||[]),...(live.viewerPresence||[]).map(p=>p.characterId)])].filter(cid=>characters.some(c=>c.id===cid)&&(!onlyCharacterId||onlyCharacterId===cid));
 const errors:unknown[]=[];
 for(const cid of ids){
  const entries=buildWeverseLiveMemory(live,cid,community?.name||"Weverse",names,true);
  for(const group of splitWeverseLiveMemory(entries)){
   const cacheKey=weverseLiveSummaryKey(cid,group.shared),key=id+":"+cacheKey;
   const fingerprint=weverseLiveFingerprint(group.entries);
   const previous=loadWeverseState().lives.find(l=>l.id===id)?.memorySummaries;
   const cached=previous?.[cacheKey]||previous?.[cid];
   if(cached?.shared===group.shared&&cached.fingerprint===fingerprint&&cached.content.trim()||runningWeverseSummaries.has(key))continue;
   runningWeverseSummaries.add(key);
   try{
    const content=await summarizeLiveText("weverse","memory",group.entries.map(e=>e.content).join("\n"));
    const latest=loadWeverseState().lives.find(l=>l.id===id&&l.status==="ended");if(!latest)return;
    const current=buildWeverseLiveMemory(latest,cid,community?.name||"Weverse",names,true).filter(e=>Boolean(e.shared)===group.shared);
    if(weverseLiveFingerprint(current)!==fingerprint)continue;
    updateWeverseLive(id,{memorySummaries:{...latest.memorySummaries,[cacheKey]:{fingerprint,content,shared:group.shared}}});
   }catch(e){errors.push(e);}finally{runningWeverseSummaries.delete(key);}
  }
 }
 if(errors.length)throw errors[0];
}
