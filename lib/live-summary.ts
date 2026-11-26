import {loadContentPrompt} from "./content-prompt-settings";
import {resolveAuxiliaryApiConfig} from "./settings-storage";
import {simpleLLMCall} from "./api-helpers";
export type LivePlatform="weverse";
export async function summarizeLiveText(platform:LivePlatform,kind:"memory"|"public",text:string):Promise<string>{
 const api=resolveAuxiliaryApiConfig("memorySummaryApiConfigId");
 if(!api)throw Error("请先配置记忆总结 API");
 if(!text.trim())throw Error("没有可总结的直播内容");
 const template=loadContentPrompt(kind==="memory"?"weverse.memory":"weverse.public");
 const hard=kind==="public"?"仅使用已公开的直播内容；不可推断私人身份、聊天、财务及后台信息。":"只使用该人物实际知情的材料，不把他人经历当作本人的经历。";
 const chunks:string[]=[];
 for(let offset=0;offset<text.length;offset+=12000){
  const out=await simpleLLMCall(api,[{role:"user",content:hard+"\n"+template+"\n只输出简洁的中文事实摘要，约300字；保留不确定性，禁止编造数字、身份和事件。\n"+text.slice(offset,offset+12000)}],{label:"直播摘要"});
  if(!out.content?.trim()||out.wasTruncated)throw Error("直播摘要生成失败，请重试");chunks.push(out.content.trim());
 }
 return chunks.join("\n");
}
