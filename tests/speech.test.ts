import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateSpeechSeconds,locateSpeechOffset,NarrationController,normalizeSpeechOffset,splitSpeechText,SPEECH_PAUSES,type SpeechScheduler} from '../lib/speech.ts';

class FakeScheduler implements SpeechScheduler {
  clock=0;
  serial=0;
  jobs=new Map<number,{callback:()=>void;due:number;active:boolean}>();
  now=()=>this.clock;
  setTimeout(callback:()=>void,delay:number) {
    const id=++this.serial;
    this.jobs.set(id,{callback,due:this.clock+delay,active:true});
    return id;
  }
  clearTimeout(handle:unknown) {const job=this.jobs.get(handle as number);if(job) job.active=false;}
  advance(milliseconds:number) {
    const until=this.clock+milliseconds;
    while(true) {
      const next=Array.from(this.jobs.entries()).filter(([,job])=>job.active&&job.due<=until).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];
      if(!next) break;
      this.clock=next[1].due;next[1].active=false;next[1].callback();
    }
    this.clock=until;
  }
  fireEvenIfCanceled(id:number) {this.jobs.get(id)!.callback();}
}

class FakeSynthesis {
  speaking=false;
  paused=false;
  utterances:SpeechSynthesisUtterance[]=[];
  cancelCount=0;
  speak(utterance:SpeechSynthesisUtterance) {this.utterances.push(utterance);this.speaking=true;}
  cancel() {this.speaking=false;this.cancelCount++;}
  pause() {this.paused=true;}
  resume() {this.paused=false;}
}

function fixture(text='第一句。第二句！第三句。') {
  const synthesis=new FakeSynthesis(),scheduler=new FakeScheduler();
  const controller=new NarrationController(synthesis,text=>({text} as SpeechSynthesisUtterance),()=>{},scheduler);
  controller.setDocument(text,'test');
  const utterance=()=>synthesis.utterances.at(-1)!;
  const end=()=>{synthesis.speaking=false;utterance().onend!({} as SpeechSynthesisEvent);};
  return {synthesis,scheduler,controller,utterance,end};
}

function assertSourceMap(text:string) {
  for(const chunk of splitSpeechText(text)) {
    assert.equal(chunk.originalOffsets.length,chunk.text.length);
    assert.equal(chunk.start,chunk.originalOffsets[0]);
    assert.equal(chunk.end,chunk.originalOffsets.at(-1)!+1);
    for(let index=0;index<chunk.text.length;index++) {
      const source=text[chunk.originalOffsets[index]],cleaned=chunk.text[index];
      // Only whitespace normalization and weak phrase separators may differ.
      // Every spoken letter, digit, and semantic mark must still map exactly.
      if(cleaned===' '&&source!==' ') assert.match(source,/[\s，,、：:—–|｜/\\]/u);
      else assert.equal(source,cleaned);
      if(index) assert.ok(chunk.originalOffsets[index]>chunk.originalOffsets[index-1]);
    }
  }
}

test('Chinese punctuation is silent; cleaned words retain exact original offsets',()=>{
  const text='  第一段。\n 第二段！  最后一句';
  const chunks=splitSpeechText(text);
  assert.deepEqual(chunks.map(chunk=>chunk.text),['第一段','第二段','最后一句']);
  assertSourceMap(text);
  assert.deepEqual(locateSpeechOffset(chunks,5),{index:1,offset:8});
  assert.equal(locateSpeechOffset(chunks,text.length),null);
});

test('Markdown heading, emphasis, lists, links and emoji are not spoken',()=>{
  const text='## 标题\n\n- **你好**，[世界](https://x.test/a(b))！👩🏽‍💻\n尾声';
  const chunks=splitSpeechText(text);
  assert.deepEqual(chunks.map(chunk=>chunk.text),['标题','你好 世界','尾声']);
  assertSourceMap(text);
  for(const removed of ['##','**','https://','👩']) {
    const next=locateSpeechOffset(chunks,text.indexOf(removed));
    assert.ok(next);
    assert.ok(next.offset>=text.indexOf(removed)+removed.length);
  }
  assert.equal(locateSpeechOffset(chunks,text.indexOf('https://'))!.offset,text.indexOf('尾声'));
});

test('fenced manuscript contents, link labels, reference links and task labels survive cleanup',()=>{
  const text='```text\n这是一段稿件。\n```\n- [x] 已完成\n> **[文章](https://a.test)**\n[参考][ref]\n[ref]: https://example.com';
  assert.deepEqual(splitSpeechText(text).map(chunk=>chunk.text),['这是一段稿件','已完成','文章','参考']);
  assertSourceMap(text);
});

test('paragraph-ending domain source badges are skipped without losing manuscript words or final progress',()=>{
  const text='这是一段读书稿，保留“引用文字”和2001这个年份。结尾仍然有正文。[dokumen.pub](https://dokumen.pub/double-your-dating.html)';
  assert.deepEqual(splitSpeechText(text).map(chunk=>chunk.text),['这是一段读书稿 保留引用文字和2001这个年份','结尾仍然有正文']);
  assertSourceMap(text);
  assert.equal(locateSpeechOffset(splitSpeechText(text),text.indexOf('[dokumen')),null);
  const {controller,scheduler,synthesis,end}=fixture(text);
  controller.play();end();scheduler.advance(100);end();
  assert.equal(synthesis.utterances.length,2);
  assert.equal(controller.getSnapshot().progress,1);
  assert.equal(controller.getSnapshot().isPlaying,false);
});

test('only matching web address labels in source position are skipped; titled links and semantic dots survive',()=>{
  const cases:[string,string[]][]=[
    ['[dokumen.pub](https://dokumen.pub/a)',[]],
    ['[Dokumen.PUB](https://dokumen.pub/a)',[]],
    ['[https://dokumen.pub/a](https://dokumen.pub/a)',[]],
    ['[www.example.com](https://example.com/a "Reference")',[]],
    ['[example.com](<https://example.com/a>)。',[]],
    ['[文章标题](https://dokumen.pub/a)',['文章标题']],
    ['[node.js](https://nodejs.org)',['node.js']],
    ['[U.S.A.](https://example.com)',['U.S.A.']],
    ['[3.14](https://example.com)',['3.14']],
    ['[dokumen.pub](mailto:hello@dokumen.pub)',['dokumen.pub']],
    ['[example.com](https://example.com/a) 后面还有正文',['example.com 后面还有正文']],
    ['[作者说明](https://example.com/a)\n\n下一段',['作者说明','下一段']],
  ];
  for(const [text,expected] of cases) {assert.deepEqual(splitSpeechText(text).map(chunk=>chunk.text),expected,text);assertSourceMap(text);}
});

test('semantic decimal, version, abbreviation, apostrophe and time punctuation is preserved',()=>{
  const text="Dr. Smith uses 3.14, U.S.A. version 1.2.3 at 10:30. Don't change snake_case_ids or well-known words.";
  assert.deepEqual(splitSpeechText(text).map(chunk=>chunk.text),[
    'Dr. Smith uses 3.14 U.S.A. version 1.2.3 at 10:30',"Don't change snake_case_ids or well-known words",
  ]);
  assertSourceMap(text);
  assert.deepEqual(splitSpeechText('1. 第一条\n2. 第二条\n1.23 米').map(chunk=>chunk.text),['第一条','第二条','1.23 米']);
  assert.deepEqual(splitSpeechText('上涨10%，剩余30％，另有 25 %。').map(chunk=>chunk.text),['上涨10% 剩余30％ 另有 25 %']);
});

test('strongest adjacent separator determines rhythm without stacking pauses',()=>{
  const chunks=splitSpeechText('甲，乙、丙：丁；戊。\n\n己');
  assert.deepEqual(chunks.map(chunk=>chunk.text),['甲 乙 丙 丁','戊','己']);
  assert.deepEqual(chunks.map(chunk=>chunk.pauseAfterMs),[80,220,0]);
  assert.deepEqual(SPEECH_PAUSES,{comma:0,colon:0,semicolon:80,sentence:100,line:100,paragraph:220});
  assertSourceMap('甲，乙、丙：丁；戊。\n\n己');
});

test('dense comma clauses stay in complete sentences without speaking punctuation or source badges',()=>{
  const text='清晨，我们读书、写字、散步，观察生活、记录想法，也把忙碌、焦虑、疲惫，慢慢放下。 [example.com](https://example.com/source)\n\n继续把每一天，读得从容。';
  const chunks=splitSpeechText(text);
  assert.deepEqual(chunks.map(chunk=>chunk.text),[
    '清晨 我们读书 写字 散步 观察生活 记录想法 也把忙碌 焦虑 疲惫 慢慢放下',
    '继续把每一天 读得从容',
  ]);
  assertSourceMap(text);
  const {controller,synthesis,scheduler,utterance,end}=fixture(text);
  controller.play();
  assert.equal(synthesis.utterances.length,1);
  assert.equal(scheduler.jobs.size,0);
  utterance().onboundary!({charIndex:utterance().text.indexOf('记录')} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset,text.indexOf('记录'));
  end();scheduler.advance(219);assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);assert.equal(synthesis.utterances.length,2);
  end();assert.equal(controller.getSnapshot().progress,1);
});

test('seek and boundary skip normalized separator spaces while preserving original manuscript offsets',()=>{
  const text='甲，、**乙**：丙。';
  const {controller,utterance}=fixture(text);
  assert.deepEqual(splitSpeechText(text).map(chunk=>chunk.text),['甲 乙 丙']);
  assertSourceMap(text);
  for(const offset of [text.indexOf('，'),text.indexOf('、'),text.indexOf('**')]) {
    controller.seek(offset/text.length);
    assert.equal(controller.getSnapshot().currentOffset,text.indexOf('乙'));
    controller.play();assert.equal(utterance().text,'乙 丙');controller.stop();
  }
  controller.seek(text.indexOf('：')/text.length);
  assert.equal(controller.getSnapshot().currentOffset,text.indexOf('丙'));
  controller.stop();controller.play();
  utterance().onboundary!({charIndex:1} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset,text.indexOf('乙'));
});

test('natural sentence transitions and completion never cancel synthesis, but stale callbacks stay invalid',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture('甲，乙；丙。\n\n丁。');
  controller.play();const cancelBaseline=synthesis.cancelCount,first=utterance();
  assert.equal(first.text,'甲 乙');
  end();scheduler.advance(79);assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);assert.equal(utterance().text,'丙');
  first.onboundary!({charIndex:1} as SpeechSynthesisEvent);
  first.onend!({} as SpeechSynthesisEvent);
  first.onerror!({error:'interrupted'} as SpeechSynthesisErrorEvent);
  assert.equal(controller.getSnapshot().currentOffset,4);
  assert.equal(controller.getSnapshot().error,null);
  assert.equal(synthesis.cancelCount,cancelBaseline);
  end();scheduler.advance(219);assert.equal(synthesis.utterances.length,2);
  scheduler.advance(1);const last=utterance();assert.equal(last.text,'丁');end();
  assert.equal(synthesis.cancelCount,cancelBaseline);
  last.onboundary!({charIndex:0} as SpeechSynthesisEvent);
  last.onend!({} as SpeechSynthesisEvent);
  last.onerror!({error:'interrupted'} as SpeechSynthesisErrorEvent);
  assert.equal(controller.getSnapshot().progress,1);
  assert.equal(controller.getSnapshot().error,null);
  assert.equal(synthesis.utterances.length,3);
  controller.seek(0.5);assert.ok(synthesis.cancelCount>cancelBaseline);
});

test('natural end before a pending volume update applies volume to the next sentence without replay',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture('甲，乙。丙。');
  controller.play();controller.setVolume(0.4);const oldVolumeTimer=scheduler.serial;
  end();scheduler.advance(100);
  assert.equal(utterance().text,'丙');assert.equal(utterance().volume,0.4);
  scheduler.fireEvenIfCanceled(oldVolumeTimer);scheduler.advance(20);
  assert.equal(synthesis.utterances.length,2);
  assert.equal(controller.getSnapshot().isPlaying,true);
});

test('long readable blocks are bounded; removed emoji do not leave broken surrogates',()=>{
  const text='甲'.repeat(19)+'😀'+'乙'.repeat(30);
  const chunks=splitSpeechText(text,20);
  assert.equal(chunks.map(chunk=>chunk.text).join(''),'甲'.repeat(19)+'乙'.repeat(30));
  assert.ok(chunks.every(chunk=>chunk.text.length<=20));
  assert.equal(chunks.some(chunk=>/[\uD800-\uDFFF]/.test(chunk.text)),false);
  assert.equal(normalizeSpeechOffset(text,20),19);
  assert.equal(locateSpeechOffset(chunks,20)!.offset,21);
  assertSourceMap(text);
});

test('duration accounts for cleaned speech and pauses, rate scales the complete estimate',()=>{
  assert.equal(estimateSpeechSeconds('  '),0);
  assert.equal(estimateSpeechSeconds('---\n👩🏽‍💻\n***'),0);
  assert.equal(estimateSpeechSeconds('慢慢读完，\n\n这段文字。',2),estimateSpeechSeconds('慢慢读完，\n\n这段文字。',1)/2);
  assert.equal(estimateSpeechSeconds('**慢慢读完**'),estimateSpeechSeconds('慢慢读完'));
});

test('real boundary mapping advances original manuscript positions through inline formatting',()=>{
  const text='**你好**世界。';
  const {controller,utterance,end}=fixture(text);
  controller.play();
  assert.equal(utterance().text,'你好世界');
  utterance().onboundary!({charIndex:2} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset,text.indexOf('世'));
  assert.equal(controller.getSnapshot().progress,text.indexOf('世')/text.length);
  end();
  assert.equal(controller.getSnapshot().progress,1);
});

test('actual boundary/end events and scheduled pauses advance all sentences then finish at 100%',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture();
  controller.play();
  assert.equal(utterance().text,'第一句');
  utterance().onboundary!({charIndex:2} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset,2);
  end();
  assert.equal(synthesis.utterances.length,1);
  scheduler.advance(99);
  assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);
  assert.equal(utterance().text,'第二句');
  end();scheduler.advance(100);
  assert.equal(utterance().text,'第三句');
  end();
  assert.equal(controller.getSnapshot().progress,1);
  assert.equal(controller.getSnapshot().isPlaying,false);
  assert.equal(synthesis.utterances.length,3);
});

test('native pause/resume does not duplicate utterances and seeking remains paused',()=>{
  const {controller,synthesis,utterance}=fixture();
  controller.play();controller.pause();
  assert.equal(controller.getSnapshot().isPaused,true);
  controller.play();
  assert.equal(synthesis.paused,false);
  assert.equal(synthesis.utterances.length,1);
  controller.pause();controller.seek(0.5);
  assert.equal(controller.getSnapshot().currentOffset,6);
  assert.equal(controller.getSnapshot().isPaused,true);
  controller.play();
  assert.equal(utterance().text,'句');
  controller.dispose();
});

test('paragraph pause freezes while paused, then resumes only its remaining milliseconds',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture('第一段。\n\n第二段。');
  controller.play();end();scheduler.advance(70);controller.pause();
  const canceled=scheduler.serial;
  scheduler.advance(10_000);scheduler.fireEvenIfCanceled(canceled);
  assert.equal(synthesis.utterances.length,1);
  assert.equal(controller.getSnapshot().isPaused,true);
  controller.play();scheduler.advance(149);
  assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);
  assert.equal(utterance().text,'第二段');
});

test('rate changes scale remaining paragraph pause and stale timer is harmless',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture('第一段。\n\n第二段。');
  controller.play();end();const originalTimer=scheduler.serial;
  scheduler.advance(60);controller.setRate(2);
  scheduler.fireEvenIfCanceled(originalTimer);
  assert.equal(synthesis.utterances.length,1);
  scheduler.advance(79);
  assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);
  assert.equal(utterance().text,'第二段');
  assert.equal(utterance().rate,2);
});

test('rate change and seek restart at source offset and invalidate canceled speech events',()=>{
  const {controller,synthesis,utterance}=fixture();
  controller.play();const original=utterance();
  original.onboundary!({charIndex:1} as SpeechSynthesisEvent);
  controller.setRate(1.5);
  assert.equal(utterance().rate,1.5);assert.equal(utterance().text,'一句');
  original.onend!({} as SpeechSynthesisEvent);
  original.onerror!({error:'interrupted'} as SpeechSynthesisErrorEvent);
  assert.equal(synthesis.utterances.length,2);assert.equal(controller.getSnapshot().error,null);
  controller.seek(2/3);
  assert.equal(utterance().text,'第三句');
});

test('seek on link destination or formatting symbols jumps forward and maps later boundaries',()=>{
  const text='前文，[链接](https://example.com)。\n**后文内容**。';
  const {controller,utterance}=fixture(text);
  controller.seek(text.indexOf('https://')/text.length);
  assert.equal(controller.getSnapshot().currentOffset,text.indexOf('后'));
  assert.equal(controller.getSnapshot().isPlaying,false);
  controller.play();assert.equal(utterance().text,'后文内容');
  utterance().onboundary!({charIndex:2} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset,text.indexOf('内'));
});

test('volume is clamped, sent on each utterance, and does not start paused speech',()=>{
  const {controller,synthesis,utterance}=fixture();
  assert.equal(controller.getSnapshot().volume,1);
  controller.setVolume(0.35);controller.play();
  assert.equal(utterance().volume,0.35);
  controller.pause();const count=synthesis.utterances.length;
  controller.setVolume(0.7);
  assert.equal(controller.getSnapshot().isPaused,true);
  assert.equal(synthesis.utterances.length,count);
  controller.play();assert.equal(utterance().volume,0.7);
  controller.setVolume(-1);assert.equal(utterance().volume,0);
  controller.setVolume(3);assert.equal(utterance().volume,1);
  controller.setVolume(NaN);assert.equal(controller.getSnapshot().volume,1);
});

test('volume slider changes coalesce, restart at latest boundary, and zero mutes immediately',()=>{
  const {controller,synthesis,scheduler,utterance}=fixture('这是一段长一些的内容。');
  controller.play();const original=utterance();
  controller.setVolume(0.8);scheduler.advance(60);controller.setVolume(0.6);
  original.onboundary!({charIndex:4} as SpeechSynthesisEvent);
  scheduler.advance(119);assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);
  assert.equal(synthesis.utterances.length,2);
  assert.equal(utterance().volume,0.6);
  assert.equal(utterance().text,'长一些的内容');
  original.onend!({} as SpeechSynthesisEvent);
  assert.equal(synthesis.utterances.length,2);
  controller.setVolume(0);
  assert.equal(synthesis.utterances.length,3);
  assert.equal(utterance().volume,0);
  assert.equal(controller.getSnapshot().isPlaying,true);
});

test('pausing a pending volume restart makes resume use a fresh utterance at saved source position',()=>{
  const {controller,synthesis,scheduler,utterance}=fixture('一段需要朗读的正文。');
  controller.play();const original=utterance();
  original.onboundary!({charIndex:3} as SpeechSynthesisEvent);
  controller.setVolume(0.35);const volumeTimer=scheduler.serial;controller.pause();
  scheduler.advance(500);scheduler.fireEvenIfCanceled(volumeTimer);
  assert.equal(synthesis.utterances.length,1);
  assert.equal(controller.getSnapshot().isPaused,true);
  assert.equal(controller.getSnapshot().currentOffset,3);
  controller.play();
  assert.equal(synthesis.utterances.length,2);
  assert.equal(utterance().volume,0.35);
  assert.equal(utterance().text,'要朗读的正文');
  original.onend!({} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().isPlaying,true);
});

test('volume changes during gaps preserve remaining pause and apply to the next utterance',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture('甲。乙。');
  controller.play();end();const previous=scheduler.serial;
  scheduler.advance(30);controller.setVolume(0.4);
  scheduler.fireEvenIfCanceled(previous);
  assert.equal(synthesis.utterances.length,1);
  scheduler.advance(69);assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);assert.equal(utterance().text,'乙');assert.equal(utterance().volume,0.4);
});

test('changing rate and volume while gap is paused cannot start playback',()=>{
  const {controller,synthesis,scheduler,utterance,end}=fixture('甲。\n\n乙。');
  controller.play();end();scheduler.advance(20);controller.pause();
  controller.setVolume(0.2);controller.setRate(2);
  scheduler.advance(9000);assert.equal(synthesis.utterances.length,1);
  controller.play();scheduler.advance(99);assert.equal(synthesis.utterances.length,1);
  scheduler.advance(1);assert.equal(utterance().text,'乙');assert.equal(utterance().volume,0.2);
});

for(const action of ['seek','rate','volume','document','stop','dispose'] as const) {
  test(`${action} invalidates old pause timer and old utterance events`,()=>{
    const {controller,synthesis,scheduler,utterance,end}=fixture('甲。\n\n乙。\n\n丙。');
    controller.play();const original=utterance();end();const oldTimer=scheduler.serial;
    if(action==='seek') controller.seek(0.8);
    if(action==='rate') controller.setRate(2);
    if(action==='volume') controller.setVolume(0.2);
    if(action==='document') controller.setDocument('新文稿。','new');
    if(action==='stop') controller.stop();
    if(action==='dispose') controller.dispose();
    const count=synthesis.utterances.length;
    scheduler.fireEvenIfCanceled(oldTimer);original.onend!({} as SpeechSynthesisEvent);
    original.onboundary!({charIndex:1} as SpeechSynthesisEvent);
    assert.equal(synthesis.utterances.length,count);
    if(action==='stop'||action==='document') assert.equal(controller.getSnapshot().currentOffset,0);
  });
}

test('voice changes apply, and errors stop playback with a useful message',()=>{
  const {controller,utterance}=fixture();
  controller.setVoice({voiceURI:'Chinese',lang:'zh-CN'} as SpeechSynthesisVoice);controller.play();
  assert.equal(utterance().voice?.voiceURI,'Chinese');
  utterance().onerror!({error:'synthesis-unavailable'} as SpeechSynthesisErrorEvent);
  assert.equal(controller.getSnapshot().isPlaying,false);assert.match(controller.getSnapshot().error!,/朗读服务/);
});

test('switching document cancels old callbacks, resets source progress, and updates snapshot identity',()=>{
  const {controller,utterance}=fixture();
  controller.play();const previous=utterance();controller.setDocument('新的内容。','new');
  previous.onboundary!({charIndex:3} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset,0);assert.equal(controller.getSnapshot().documentId,'new');
  assert.equal(controller.getSnapshot().isPlaying,false);
  controller.play();assert.equal(utterance().text,'新的内容');
});

test('trailing decoration finishes at 100%; decoration-only content never speaks an empty string',()=>{
  const {controller,synthesis,end}=fixture('**读完**。\n---\n🙂');
  controller.play();assert.equal(synthesis.utterances[0].text,'读完');end();
  assert.equal(controller.getSnapshot().progress,1);assert.equal(controller.getSnapshot().isPlaying,false);
  const empty=fixture('---\n👩🏽‍💻\n***');empty.controller.play();
  assert.equal(empty.synthesis.utterances.length,0);assert.equal(empty.controller.getSnapshot().isPlaying,false);
  assert.match(empty.controller.getSnapshot().error!,/正文/);
  empty.controller.seek(0);
  assert.equal(empty.controller.getSnapshot().progress,0);
  empty.controller.seek(0.8);
  assert.equal(empty.controller.getSnapshot().progress,0);
  empty.controller.play();assert.match(empty.controller.getSnapshot().error!,/正文/);
});
