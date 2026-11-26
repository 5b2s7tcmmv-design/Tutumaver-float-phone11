'use client';
import {useEffect,useRef} from 'react';
export function StorageHealth(){
  const last=useRef(0);
  useEffect(()=>{
    const fail=()=>{
      const now=Date.now();
      if(now-last.current<30000)return;
      last.current=now;
      window.dispatchEvent(new CustomEvent("global-notice",{detail:"本地保存失败。建议在数据管理中手动重试保存或导出备份，请勿清除数据或卸载应用。"}));
    };
    window.addEventListener('local-storage-failure',fail);
    void navigator.storage?.persist?.().catch(()=>false);
    return()=>window.removeEventListener('local-storage-failure',fail);
  },[]);
  return null;
}
