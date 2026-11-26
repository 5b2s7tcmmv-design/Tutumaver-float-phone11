let liveId:string|null=null;
let backgroundStartedAt=0;
export const WVS_BACKGROUND='wvs-background-live';
export function setWvsBackground(id:string|null){if(liveId!==id){backgroundStartedAt=id?Date.now():0;}liveId=id;if(typeof window!=='undefined')window.dispatchEvent(new Event(WVS_BACKGROUND));}
export function getWvsBackground(){return liveId;}

export function getWvsBackgroundStartedAt(){return backgroundStartedAt;}
