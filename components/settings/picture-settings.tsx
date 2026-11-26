'use client';
import {useContext,useEffect,useState} from 'react';
import {SettingsContext} from '../phone-settings-app';
import {TextImageMaskSetting} from './text-image-mask-setting';
import {loadMediaPreferences,saveMediaPreferences,MEDIA_APPS,type MediaApp,type PhotoDeliveryMode} from '@/lib/media-preferences';
import {ImagePromptLanguageSetting} from './image-prompt-language-setting';
/** Keep shared-edition AI behavior and generation-prompt screens unchanged. */
export function PictureSettings(){
 const {setSubpageTitle}=useContext(SettingsContext);
 const [prefs,setPrefs]=useState(loadMediaPreferences);
 useEffect(()=>{setSubpageTitle('图片设置');return()=>setSubpageTitle(null);},[setSubpageTitle]);
 return <div className="ai-behavior-page flex flex-col gap-4">
   <TextImageMaskSetting/>
   <ImagePromptLanguageSetting/>
   <section className="settings-option-group"><p className="menu-desc">图片交付方式（默认文字图）</p>{Object.entries(MEDIA_APPS).map(([id,name])=><label key={id} className="ai-media-row"><span>{name}</span><select value={prefs.delivery[id as MediaApp]||'text'} onChange={e=>{const next={...prefs,delivery:{...prefs.delivery,[id]:e.target.value as PhotoDeliveryMode}};setPrefs(next);saveMediaPreferences(next);}}><option value="text">文字图</option><option value="auto">自动处理图片</option></select></label>)}</section>
   <p className="menu-desc ai-media-note">自定义遮罩在所有文字图中同步生效；这里的语言设置只影响之后新生成的图片描述，不更改已有图片和正文。</p>
 </div>;
}
