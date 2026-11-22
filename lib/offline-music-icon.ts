import {kvGet,kvSet,registerKvMigration} from './kv-db';
export type OfflineMusicTheme='day'|'night';
const KEYS={day:'ai_phone_offline_music_icon_day',night:'ai_phone_offline_music_icon_night'};
for(const key of Object.values(KEYS))registerKvMigration(key);
export function defaultOfflineMusicIcon(theme:OfflineMusicTheme='day'){return "/offline-music/default-icon.png"; // bundled fallback; customized day/night icons override individually}
export const DEFAULT_OFFLINE_MUSIC_ICON='/offline-music/default-icon.png';
export function loadOfflineMusicIcon(theme:OfflineMusicTheme='day'){return kvGet(KEYS[theme])||defaultOfflineMusicIcon(theme);}
export function saveOfflineMusicIcon(ref?:string,theme:OfflineMusicTheme='day'){kvSet(KEYS[theme],ref||'');window.dispatchEvent(new Event('offline-music-icon-updated'));}
