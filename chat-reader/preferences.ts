import {extensionApi} from './platform.ts';

export const CHAT_READER_STORAGE_KEY='tingjian.chat-reader.v1';
export interface SavedPosition {signature:string;progress:number;}
export interface ReaderPreferences {
  autoCollapse:boolean;
  follow:boolean;
  rate:number;
  volume:number;
  voiceId:string|null;
  collapsed:Record<string,boolean>;
  positions:Record<string,SavedPosition>;
  selectedByConversation:Record<string,string>;
}

export function defaultPreferences():ReaderPreferences {
  return {autoCollapse:true,follow:true,rate:1,volume:1,voiceId:null,collapsed:{},positions:{},selectedByConversation:{}};
}

function entries(value:unknown,limit:number):[string,unknown][] {
  if(!value||typeof value!=='object'||Array.isArray(value)) return [];
  return Object.entries(value).filter(([key])=>key.length<=400&&!['__proto__','prototype','constructor'].includes(key)).slice(-limit);
}

export function validatePreferences(input:unknown):ReaderPreferences {
  const result=defaultPreferences();
  if(!input||typeof input!=='object') return result;
  const raw=input as Record<string,unknown>;
  for(const key of ['autoCollapse','follow'] as const) if(typeof raw[key]==='boolean') result[key]=raw[key];
  if(typeof raw.rate==='number'&&Number.isFinite(raw.rate)) result.rate=Math.max(0.5,Math.min(2.5,raw.rate));
  if(typeof raw.volume==='number'&&Number.isFinite(raw.volume)) result.volume=Math.max(0,Math.min(1,raw.volume));
  if(typeof raw.voiceId==='string'&&raw.voiceId.length<=500) result.voiceId=raw.voiceId;
  result.collapsed=Object.fromEntries(entries(raw.collapsed,300).filter(([,value])=>typeof value==='boolean')) as Record<string,boolean>;
  result.selectedByConversation=Object.fromEntries(entries(raw.selectedByConversation,60).filter(([,value])=>typeof value==='string'&&value.length<=200)) as Record<string,string>;
  for(const [key,value] of entries(raw.positions,250)) {
    if(!value||typeof value!=='object') continue;
    const position=value as SavedPosition;
    if(typeof position.signature==='string'&&position.signature.length<=40&&typeof position.progress==='number'&&Number.isFinite(position.progress)&&position.progress>=0&&position.progress<=1) {
      result.positions[key]={signature:position.signature,progress:position.progress};
    }
  }
  return result;
}

export async function loadPreferences():Promise<ReaderPreferences> {
  try {
    const storage=extensionApi()?.storage?.local;
    const raw=storage?(await storage.get(CHAT_READER_STORAGE_KEY))[CHAT_READER_STORAGE_KEY]:JSON.parse(localStorage.getItem(CHAT_READER_STORAGE_KEY)||'null');
    return validatePreferences(raw);
  } catch {return defaultPreferences();}
}

export async function savePreferences(value:ReaderPreferences):Promise<void> {
  const safe=validatePreferences(value);
  const storage=extensionApi()?.storage?.local;
  if(storage) await storage.set({[CHAT_READER_STORAGE_KEY]:safe});
  else localStorage.setItem(CHAT_READER_STORAGE_KEY,JSON.stringify(safe));
}

/** A consistency check for saved progress; manuscript contents are never persisted. */
export function contentSignature(text:string):string {
  let hash=2166136261;
  for(let index=0;index<text.length;index++) hash=Math.imul(hash^text.charCodeAt(index),16777619);
  return `${text.length}-${(hash>>>0).toString(16)}`;
}
