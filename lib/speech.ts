export interface SpeechChunk {
  /** Only this cleaned text is sent to the speech service. */
  text: string;
  start: number;
  end: number;
  /** Each cleaned UTF-16 unit maps to the source; normalized spaces map to separators. */
  originalOffsets: number[];
  /** Base-rate pause; adjacent punctuation uses the strongest pause. */
  pauseAfterMs: number;
}

export const SPEECH_PAUSES = {comma:0,colon:0,semicolon:80,sentence:100,line:100,paragraph:220};

/** Address-only source badges at the end of a paragraph are not manuscript prose. */
function isSourceAddress(label:string,destination:string):boolean {
  const display=label.trim();
  if(!display||/\s/.test(display)) return false;
  try {
    const explicitUrl=/^https?:\/\//i.test(display);
    const shown=new URL(explicitUrl?display:`https://${display}`);
    if(!explicitUrl&&(/[\\/?#:@]/.test(display)||shown.pathname!=='/')) return false;
    const hostPattern=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;
    if(!hostPattern.test(shown.hostname)||shown.username||shown.password) return false;
    const address=/^(?:<([^>]+)>|(\S+))/.exec(destination.trim());
    if(!address) return false;
    const target=new URL(address[1]||address[2]);
    if(!/^https?:$/.test(target.protocol)) return false;
    const hostname=(url:URL)=>url.hostname.toLowerCase().replace(/^www\./,'');
    return hostname(shown)===hostname(target);
  } catch {return false;}
}

function manuscriptMask(text:string):Uint8Array {
  const mask=new Uint8Array(text.length);
  const remove=(start:number,end:number)=>mask.fill(1,start,end);
  const removeMatches=(pattern:RegExp)=>{
    for(const match of text.matchAll(pattern)) remove(match.index!,match.index!+match[0].length);
  };
  // Keep fenced contents: a pasted manuscript may itself be in a text fence.
  removeMatches(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm);
  removeMatches(/^[ \t]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:=[ \t]*){3,}|(?:[—─━·•][ \t]*){3,})$/gm);
  removeMatches(/^[ \t]{0,3}#{1,6}[ \t]+/gm);
  removeMatches(/[ \t]+#+[ \t]*$/gm);
  removeMatches(/^[ \t]*(?:[-+*][ \t]+\[[ xX]\][ \t]*|(?:[-+*]|\d{1,9}[.)、]|[（(]\d{1,4}[)）])[ \t]+)/gm);
  removeMatches(/^[ \t]*>[ \t>]*/gm);
  removeMatches(/^[ \t]*\[[^\]\n]+\]:[^\n]*$/gm);
  // Balanced destinations preserve readable labels and their exact source offsets.
  for(const match of text.matchAll(/!?\[([^\]\n]+)\]\(/g)) {
    let cursor=match.index!+match[0].length,depth=1;
    while(cursor<text.length&&depth) {
      if(text[cursor]==='\\') {cursor+=2;continue;}
      if(text[cursor]==='(') depth++;
      if(text[cursor]===')') depth--;
      cursor++;
    }
    if(depth) continue;
    const labelStart=match.index!+(match[0].startsWith('!')?2:1);
    const lineSuffix=text.slice(cursor).split(/\r?\n/,1)[0];
    const endsParagraph=/^[ \t。！？.!?…）)\]】」』”’]*$/.test(lineSuffix);
    const destination=text.slice(match.index!+match[0].length,cursor-1);
    if(endsParagraph&&isSourceAddress(match[1],destination)) {
      remove(match.index!,cursor);continue;
    }
    remove(match.index!,labelStart);remove(labelStart+match[1].length,cursor);
  }
  for(const match of text.matchAll(/!?\[([^\]\n]+)\]\[[^\]\n]*\]/g)) {
    const labelStart=match.index!+(match[0].startsWith('!')?2:1);
    remove(match.index!,labelStart);remove(labelStart+match[1].length,match.index!+match[0].length);
  }
  for(const match of text.matchAll(/(\*{1,3}|_{1,3}|~~|`{1,3})(?=\S)([\s\S]*?\S)\1/g)) {
    const start=match.index!,marker=match[1],end=start+match[0].length;
    if(marker[0]==='_'&&(/\w/.test(text[start-1]||'')||/\w/.test(text[end]||''))) continue;
    remove(start,start+marker.length);remove(end-marker.length,end);
  }
  removeMatches(/[#*0-9]\uFE0F?\u20E3/gu);
  removeMatches(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu);
  return mask;
}

function semanticPunctuation(text:string,index:number,char:string):boolean {
  const before=text[index-1]||'',after=text[index+1]||'';
  if((char==='%'||char==='％')&&/[0-9０-９][ \t]*$/.test(text.slice(0,index))) return true;
  if((char==="'"||char==='’')&&/[A-Za-z]/.test(before)&&/[A-Za-z]/.test(after)) return true;
  if((char==='-'||char==='_')&&/[A-Za-z0-9]/.test(before)&&/[A-Za-z0-9]/.test(after)) return true;
  if((char===':'||char==='/')&&/\d/.test(before)&&/\d/.test(after)) return true;
  if(char!=='.') return false;
  if(/\d/.test(before)&&/\d/.test(after)) return true;
  if(/[A-Za-z]/.test(before)&&/[A-Za-z]/.test(after)) return true;
  const token=text.slice(Math.max(0,index-15),index+1);
  return /(?:\b[A-Za-z]\.){2,}$/.test(token)||/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\.$/i.test(token);
}

/** Clean for narration only; keep a source map instead of rewriting manuscripts. */
export function splitSpeechText(text:string,maxLength=130):SpeechChunk[] {
  const chunks:SpeechChunk[]=[];
  const limit=Number.isFinite(maxLength)?Math.max(20,Math.floor(maxLength)):130;
  const mask=manuscriptMask(text);
  let value='',offsets:number[]=[];
  const flush=(pause:number)=>{
    while(value.endsWith(' ')) {value=value.slice(0,-1);offsets.pop();}
    if(value) {
      chunks.push({text:value,start:offsets[0],end:offsets.at(-1)!+1,originalOffsets:offsets,pauseAfterMs:pause});
      value='';offsets=[];
    } else if(chunks.length) chunks[chunks.length-1].pauseAfterMs=Math.max(chunks[chunks.length-1].pauseAfterMs,pause);
  };
  const append=(char:string,index:number)=>{
    value+=char;
    for(let unit=0;unit<char.length;unit++) offsets.push(index+unit);
    if(value.length>=limit) flush(0);
  };
  const joinPhrase=(sourceIndex:number)=>{if(value&&!value.endsWith(' ')) append(' ',sourceIndex);};
  for(let index=0;index<text.length;) {
    const char=String.fromCodePoint(text.codePointAt(index)!);
    const sourceIndex=index;index+=char.length;
    if(mask[sourceIndex]) continue;
    if(char==='\r') continue;
    if(char==='\n') {
      flush(/^[ \t\r]*\n/.test(text.slice(index))?SPEECH_PAUSES.paragraph:SPEECH_PAUSES.line);
      continue;
    }
    if(/\s/.test(char)) {if(value&&!value.endsWith(' ')) append(' ',sourceIndex);continue;}
    if(semanticPunctuation(text,sourceIndex,char)) {append(char,sourceIndex);continue;}
    // Let the system voice carry a sentence continuously instead of restarting
    // its synthesis service for every comma or item in an enumeration.
    if(/[，,、：:]/.test(char)) {joinPhrase(sourceIndex);continue;}
    if(/[；;]/.test(char)) {flush(SPEECH_PAUSES.semicolon);continue;}
    if(/[。！？!?.]/.test(char)) {flush(SPEECH_PAUSES.sentence);continue;}
    if(char==='…') {flush(SPEECH_PAUSES.sentence);continue;}
    if(/[—–|｜/\\]/.test(char)) {joinPhrase(sourceIndex);continue;}
    // Quotes, brackets and leftover Markdown decorations never reach the voice.
    if(/[\p{P}\p{Cf}★☆✦✧●○◆◇■□▪▫]/u.test(char)) continue;
    append(char,sourceIndex);
  }
  flush(0);
  return chunks;
}

export function normalizeSpeechOffset(text:string,offset:number):number {
  let value=Math.max(0,Math.min(text.length,Number.isFinite(offset)?Math.round(offset):0));
  if(value>0&&value<text.length&&/[\uDC00-\uDFFF]/.test(text[value])) value--;
  return value;
}

function lowerBound(offsets:number[],target:number):number {
  let low=0,high=offsets.length;
  while(low<high) {const mid=(low+high)>>>1;if(offsets[mid]<target) low=mid+1;else high=mid;}
  return low;
}

/** Seek on removed symbols moves forward to the next readable source character. */
export function locateSpeechOffset(chunks:SpeechChunk[],offset:number):{index:number;offset:number}|null {
  for(let index=0;index<chunks.length;index++) {
    let cleanedIndex=lowerBound(chunks[index].originalOffsets,offset);
    while(cleanedIndex<chunks[index].text.length&&/\s/.test(chunks[index].text[cleanedIndex])) cleanedIndex++;
    if(cleanedIndex<chunks[index].originalOffsets.length) return {index,offset:chunks[index].originalOffsets[cleanedIndex]};
  }
  return null;
}

function chunkDuration(chunks:SpeechChunk[]):number {
  const text=chunks.map(chunk=>chunk.text).join(' ');
  const chinese=(text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)||[]).length;
  const words=(text.match(/[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g)||[]).length;
  return chunks.length?Math.max(1,chinese/4.2+words/2.6+chunks.slice(0,-1).reduce((sum,chunk)=>sum+chunk.pauseAfterMs/1000,0)):0;
}

/** A reading estimate, not a prerecorded audio duration. */
export function estimateSpeechSeconds(text:string,rate=1):number {
  return chunkDuration(splitSpeechText(text))/Math.max(0.5,Number.isFinite(rate)?rate:1);
}

export interface NarrationSnapshot {
  documentId:string;
  isPlaying:boolean;
  isPaused:boolean;
  currentOffset:number;
  progress:number;
  durationSeconds:number;
  elapsedSeconds:number;
  rate:number;
  volume:number;
  voiceId:string;
  error:string|null;
}

interface SynthesisPort {
  speaking:boolean;
  paused:boolean;
  speak(utterance:SpeechSynthesisUtterance):void;
  cancel():void;
  pause():void;
  resume():void;
}

export interface SpeechScheduler {
  now():number;
  setTimeout(callback:()=>void,delay:number):unknown;
  clearTimeout(handle:unknown):void;
}

const defaultScheduler:SpeechScheduler={
  now:()=>Date.now(),setTimeout:(callback,delay)=>setTimeout(callback,delay),
  clearTimeout:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const emptyNarrationSnapshot:NarrationSnapshot={
  documentId:'',isPlaying:false,isPaused:false,currentOffset:0,progress:0,
  durationSeconds:0,elapsedSeconds:0,rate:1,volume:1,voiceId:'',error:null,
};

const errors:Record<string,string>={
  'not-allowed':'浏览器暂不允许朗读，请点击播放按钮后重试。',
  'voice-unavailable':'所选声音暂不可用，请切换其他声音。',
  'language-unavailable':'设备尚未安装对应语言的朗读声音。',
  'synthesis-unavailable':'设备没有可用的朗读服务，请安装系统语音或换用其他浏览器。',
  'synthesis-failed':'朗读服务启动失败，请切换声音，或检查设备是否已安装中文语音。',
  'network':'当前声音需要网络连接，请检查网络或选择设备上的其他声音。',
  'audio-busy':'设备音频正在被占用，请稍后重试。',
  'audio-hardware':'设备音频不可用，请检查声音输出设置。',
  'text-too-long':'朗读服务无法处理这段文字，请重新播放。',
};

interface ReadingGap {nextOffset:number;remainingMs:number;startedAt:number;}

/** Each utterance and each inter-phrase pause timer belongs to a generation. */
export class NarrationController {
  private text='';
  private documentId='';
  private chunks:SpeechChunk[]=[];
  private baseDuration=0;
  private state:NarrationSnapshot={...emptyNarrationSnapshot};
  private generation=0;
  private utterance:SpeechSynthesisUtterance|null=null;
  private voice:SpeechSynthesisVoice|null=null;
  private resumeTimer:unknown|null=null;
  private gapTimer:unknown|null=null;
  private volumeTimer:unknown|null=null;
  private volumeVersion=0;
  private gap:ReadingGap|null=null;
  private disposed=false;
  private synthesis:SynthesisPort;
  private makeUtterance:(text:string)=>SpeechSynthesisUtterance;
  private onChange:(snapshot:NarrationSnapshot)=>void;
  private scheduler:SpeechScheduler;

  constructor(synthesis:SynthesisPort,makeUtterance:(text:string)=>SpeechSynthesisUtterance,onChange:(snapshot:NarrationSnapshot)=>void,scheduler:SpeechScheduler=defaultScheduler) {
    this.synthesis=synthesis;this.makeUtterance=makeUtterance;this.onChange=onChange;this.scheduler=scheduler;
  }

  getSnapshot():NarrationSnapshot {return {...this.state};}

  private emit(update:Partial<NarrationSnapshot>={}) {
    this.state={...this.state,...update,documentId:this.documentId};
    this.state.durationSeconds=this.baseDuration/this.state.rate;
    this.state.progress=this.text.length?this.state.currentOffset/this.text.length:0;
    this.state.elapsedSeconds=this.state.durationSeconds*this.state.progress;
    if(!this.disposed) this.onChange(this.getSnapshot());
  }

  private clearVolumeTimer() {
    this.volumeVersion++;
    if(this.volumeTimer!==null) this.scheduler.clearTimeout(this.volumeTimer);
    this.volumeTimer=null;
  }

  private cancelCurrent(interruptSpeech=true) {
    // Natural transitions still invalidate callbacks, but do not tear down a
    // speech service whose utterance has already ended.
    this.generation++;
    if(this.resumeTimer!==null) this.scheduler.clearTimeout(this.resumeTimer);
    if(this.gapTimer!==null) this.scheduler.clearTimeout(this.gapTimer);
    this.clearVolumeTimer();
    this.resumeTimer=null;this.gapTimer=null;this.gap=null;this.utterance=null;
    if(interruptSpeech) this.synthesis.cancel();
  }

  setDocument(text:string,documentId:string) {
    if(this.text===text&&this.documentId===documentId) return;
    this.cancelCurrent();this.text=text;this.documentId=documentId;
    this.chunks=splitSpeechText(text);this.baseDuration=chunkDuration(this.chunks);
    this.emit({currentOffset:0,isPlaying:false,isPaused:false,error:null});
  }

  private complete(interruptSpeech=true) {
    this.cancelCurrent(interruptSpeech);this.emit({currentOffset:this.text.length,isPlaying:false,isPaused:false,error:null});
  }

  private remainingGap():ReadingGap|null {
    if(!this.gap) return null;
    return {...this.gap,remainingMs:Math.max(0,this.gap.remainingMs-(this.gapTimer!==null?this.scheduler.now()-this.gap.startedAt:0))};
  }

  private scheduleGap() {
    if(!this.gap||!this.state.isPlaying||this.disposed) return;
    const gap=this.gap,token=this.generation;
    gap.startedAt=this.scheduler.now();
    this.gapTimer=this.scheduler.setTimeout(()=>{
      if(this.disposed||token!==this.generation||!this.state.isPlaying||this.gap!==gap) return;
      this.gapTimer=null;this.gap=null;this.startAt(gap.nextOffset,false);
    },gap.remainingMs);
  }

  private startAt(offset:number,interruptSpeech=true) {
    if(this.disposed) return;
    this.cancelCurrent(interruptSpeech);
    if(this.synthesis.paused) this.synthesis.resume();
    const position=locateSpeechOffset(this.chunks,normalizeSpeechOffset(this.text,offset));
    if(!position) {this.complete(false);return;}
    const token=this.generation,chunk=this.chunks[position.index];
    const cleanedStart=lowerBound(chunk.originalOffsets,position.offset);
    const utterance=this.makeUtterance(chunk.text.slice(cleanedStart));
    this.utterance=utterance;
    utterance.lang=this.voice?.lang||'zh-CN';utterance.rate=this.state.rate;
    utterance.volume=this.state.volume;utterance.voice=this.voice;
    const current=()=>!this.disposed&&token===this.generation;
    utterance.onboundary=event=>{
      if(!current()) return;
      const boundary=Number.isFinite(event.charIndex)?Math.max(0,Math.floor(event.charIndex)):0;
      let cleanedIndex=cleanedStart+boundary;
      while(cleanedIndex<chunk.text.length&&/\s/.test(chunk.text[cleanedIndex])) cleanedIndex++;
      const source=chunk.originalOffsets[cleanedIndex]??chunk.end;
      this.emit({currentOffset:normalizeSpeechOffset(this.text,source)});
    };
    utterance.onend=()=>{
      if(!current()) return;
      this.utterance=null;this.clearVolumeTimer();
      const next=this.chunks[position.index+1];
      if(!next) {this.complete(false);return;}
      this.generation++;
      if(this.resumeTimer!==null) this.scheduler.clearTimeout(this.resumeTimer);
      this.resumeTimer=null;
      this.gap={nextOffset:next.start,remainingMs:chunk.pauseAfterMs/this.state.rate,startedAt:this.scheduler.now()};
      this.emit({currentOffset:chunk.end});this.scheduleGap();
    };
    utterance.onerror=event=>{
      if(!current()) return;
      this.cancelCurrent();this.emit({isPlaying:false,isPaused:false,error:errors[event.error]||'朗读已中断，请点击播放重新开始。'});
    };
    this.emit({currentOffset:position.offset,isPlaying:true,isPaused:false,error:null});
    try {this.synthesis.speak(utterance);}
    catch {if(current()) {this.cancelCurrent();this.emit({isPlaying:false,isPaused:false,error:'无法启动朗读，请检查设备的语音设置。'});}}
  }

  play() {
    if(!this.text.trim()||this.disposed||this.state.isPlaying) return;
    if(!this.chunks.length) {this.emit({error:'这篇稿件暂时没有可朗读的正文。'});return;}
    if(this.state.isPaused&&this.gap) {
      this.emit({isPlaying:true,isPaused:false,error:null});this.scheduleGap();return;
    }
    if(this.state.isPaused&&this.utterance&&this.synthesis.speaking) {
      const token=this.generation;
      this.synthesis.resume();this.emit({isPlaying:true,isPaused:false,error:null});
      this.resumeTimer=this.scheduler.setTimeout(()=>{
        if(token===this.generation&&this.state.isPlaying&&this.synthesis.paused) this.startAt(this.state.currentOffset);
      },250);
      return;
    }
    this.startAt(this.state.currentOffset>=this.text.length?0:this.state.currentOffset);
  }

  pause() {
    if(!this.state.isPlaying||this.disposed) return;
    // A voice may sample volume only at speak(). If a slider restart is still
    // pending, resume must create a new utterance instead of reviving old audio.
    if(this.volumeTimer!==null&&!this.gap) {
      this.cancelCurrent();this.emit({isPlaying:false,isPaused:true});return;
    }
    this.clearVolumeTimer();
    if(this.gap) {
      const remaining=this.remainingGap();
      if(this.gapTimer!==null) this.scheduler.clearTimeout(this.gapTimer);
      this.gapTimer=null;this.gap=remaining;this.generation++;
    } else this.synthesis.pause();
    this.emit({isPlaying:false,isPaused:true});
  }

  toggle() {this.state.isPlaying?this.pause():this.play();}

  seek(progress:number) {
    if(!this.chunks.length) {
      this.cancelCurrent();this.emit({currentOffset:0,isPlaying:false,isPaused:false,error:null});return;
    }
    const target=normalizeSpeechOffset(this.text,Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0))*this.text.length);
    const offset=locateSpeechOffset(this.chunks,target)?.offset??this.text.length;
    const {isPlaying,isPaused}=this.state;
    if(isPlaying) this.startAt(offset);
    else {this.cancelCurrent();this.emit({currentOffset:offset,isPaused:isPaused&&offset<this.text.length,error:null});}
  }

  private changeSettings(update:Partial<NarrationSnapshot>) {
    const {isPlaying,isPaused,currentOffset,rate}=this.state;
    const gap=this.remainingGap();
    this.cancelCurrent();this.emit(update);
    if(gap) {
      gap.remainingMs*=rate/this.state.rate;this.gap=gap;
      if(isPlaying) this.scheduleGap();else this.emit({isPaused});
    } else if(isPlaying) this.startAt(currentOffset,false);
    else this.emit({isPaused});
  }

  setRate(rate:number) {
    if(!Number.isFinite(rate)) return;
    const value=Math.max(0.5,Math.min(2.5,rate));
    if(value!==this.state.rate) this.changeSettings({rate:value});
  }

  setVolume(volume:number) {
    if(!Number.isFinite(volume)) return;
    const value=Math.max(0,Math.min(1,volume));
    if(value===this.state.volume) return;
    if(!this.state.isPlaying||this.gap||!this.utterance||value===0||this.state.volume===0) {
      this.changeSettings({volume:value});return;
    }
    // Some voices only sample volume when speak() starts. Apply the object value
    // now, then coalesce a slider drag into one restart at the latest boundary.
    this.utterance.volume=value;this.emit({volume:value});this.clearVolumeTimer();
    const version=this.volumeVersion,token=this.generation;
    this.volumeTimer=this.scheduler.setTimeout(()=>{
      if(version!==this.volumeVersion||token!==this.generation||!this.state.isPlaying||this.gap||this.disposed) return;
      this.volumeTimer=null;this.startAt(this.state.currentOffset);
    },120);
  }

  setVoice(voice:SpeechSynthesisVoice|null) {
    const voiceId=voice?.voiceURI||'';
    if(voiceId===this.state.voiceId) return;
    this.voice=voice;this.changeSettings({voiceId});
  }

  stop() {this.cancelCurrent();this.emit({isPlaying:false,isPaused:false,currentOffset:0,error:null});}
  dispose() {this.disposed=true;this.cancelCurrent();}
}
