'use client';
import {useRef,useState} from 'react';
import {saveOfflineMusicIcon,type OfflineMusicTheme} from '@/lib/offline-music-icon';
import {saveChatImageToIndexedDB} from '@/lib/chat-asset-storage';
export function OfflineMusicIconSetting(){
 const input=useRef<HTMLInputElement>(null),theme=useRef<OfflineMusicTheme>('day');const [error,setError]=useState('');
 return <><div className="menu-item offline-icon-setting"><div className="menu-label-group"><span className="menu-label">音乐悬浮窗图标</span>{error&&<span role="alert" className="menu-desc">{error}</span>}</div><div className="menu-right offline-icon-actions">{(['day','night'] as const).map(t=><button key={t} type="button" onClick={()=>{theme.current=t;input.current?.click();}}>替换{t==='day'?'日间':'夜间'}</button>)}</div><input hidden ref={input} type="file" accept="image/*" onChange={async e=>{const file=e.target.files?.[0],selected=theme.current;e.target.value='';if(!file)return;try{if(file.size>5*1024*1024)throw Error('请选择 5MB 内的图片');saveOfflineMusicIcon('asset://'+await saveChatImageToIndexedDB(file),selected);setError('');}catch(err){setError(err instanceof Error?err.message:'保存失败');}}}/></div><div className="menu-item offline-icon-reset"><span className="menu-desc">恢复默认音乐图标</span><div className="offline-icon-actions"><button type="button" onClick={()=>saveOfflineMusicIcon(undefined,'day')}>日间</button><button type="button" onClick={()=>saveOfflineMusicIcon(undefined,'night')}>夜间</button></div></div></>;
}
