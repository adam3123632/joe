import {NarrationController,emptyNarrationSnapshot,type NarrationSnapshot} from '../lib/speech';
import {scanMessages,pickMessageAt,decorateMessage,cleanupDecorations,highlightParagraph,clearHighlights,LONG_MESSAGE_THRESHOLD,type ChatMessage} from './dom';
import {mountPanel,type PanelView,type PanelState} from './ui';
import {createOwnedSpeechPort} from './speech-port';
import {loadPreferences,savePreferences,contentSignature,type ReaderPreferences} from './preferences';
import {extensionApi,type RuntimeListener} from './platform';

declare global {interface Window {__tingjianChatReader?:{open():void;destroy():void};}}

async function startReader() {
  if(window.top!==window||!['chatgpt.com','chat.openai.com'].includes(location.hostname)) return;
  if(window.__tingjianChatReader) {window.__tingjianChatReader.open();return;}
  const existing=document.getElementById('tingjian-chat-reader-ui');
  if(existing) {existing.dispatchEvent(new Event('tingjian:open'));return;}

  let pendingOpen=false;
  window.__tingjianChatReader={open:()=>{pendingOpen=true;},destroy:()=>{}};
  let preferences:ReaderPreferences=await loadPreferences();
  let route=location.pathname;
  let messages:ChatMessage[]=[];
  let pickedMessage:ChatMessage|null=null;
  let picking=false;
  let pickStyle:HTMLStyleElement|null=null;
  let selectedId='';
  let bound:ChatMessage|null=null;
  let boundRoute=route;
  let snapshot:NarrationSnapshot={...emptyNarrationSnapshot,rate:preferences.rate,volume:preferences.volume};
  let engine:NarrationController|null=null;
  let panel:PanelView;
  let notice:string|null=null;
  let disposed=false;
  let voices:SpeechSynthesisVoice[]=[];
  let scanTimer:ReturnType<typeof setTimeout>|null=null;
  let idleScan:number|null=null;
  let saveTimer:ReturnType<typeof setTimeout>|null=null;
  let renderFrame=0;
  let lastSavedAt=0;
  let lastHighlighted='';
  const supported='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
  const messageKey=(id:string,path=route)=>`${path}::${id}`;
  const selected=()=>messages.find(message=>message.id===selectedId)||((bound?.id===selectedId&&boundRoute===route)?bound:null);
  const paragraphIndex=(message:ChatMessage,offset:number)=>{
    const index=message.paragraphs.findIndex(paragraph=>offset<paragraph.end);
    return index<0?Math.max(0,message.paragraphs.length-1):index;
  };

  function queueSave() {
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      saveTimer=null;
      void savePreferences(preferences).catch(()=>{notice='偏好暂时无法保存，本次阅读仍可继续。';requestRender();});
    },250);
  }

  function storePosition() {
    if(!bound||snapshot.documentId!==messageKey(bound.id,boundRoute)) return;
    const key=messageKey(bound.id,boundRoute);
    delete preferences.positions[key];
    preferences.positions[key]={signature:contentSignature(bound.text),progress:snapshot.progress};
    queueSave();
  }

  function isCollapsed(message:ChatMessage):boolean {
    if(message.isStreaming||message.charCount<LONG_MESSAGE_THRESHOLD) return false;
    return preferences.collapsed[messageKey(message.id)]??preferences.autoCollapse;
  }

  function expand(message:ChatMessage,persist=true) {
    if(persist) {preferences.collapsed[messageKey(message.id)]=false;queueSave();}
    decorate(message,false);
  }

  function decorate(message:ChatMessage,collapsed=isCollapsed(message)) {
    decorateMessage(message,{
      collapsed,
      onToggle:()=>{
        const next=!isCollapsed(message);
        preferences.collapsed[messageKey(message.id)]=next;
        if(next&&bound?.id===message.id&&snapshot.isPlaying) preferences.follow=false;
        decorate(message,next);queueSave();requestRender();
      },
      onRead:()=>{choose(message.id,false);panel.setOpen(true);play();},
    });
  }

  function onSnapshot(next:NarrationSnapshot) {
    snapshot=next;
    if(bound&&next.documentId===messageKey(bound.id,boundRoute)) {
      if(next.isPlaying||next.isPaused) {
        const current=selected();
        if(current?.contentElement.isConnected) {
          const index=paragraphIndex(current,next.currentOffset);
          const highlightId=`${current.id}:${index}`;
          if(highlightId!==lastHighlighted) {
            highlightParagraph(current,next.currentOffset,preferences.follow&&next.isPlaying);
            lastHighlighted=highlightId;
          }
        }
      } else {clearHighlights();lastHighlighted='';}
      if((next.isPlaying||next.isPaused||next.progress===1)&&(next.progress===1||Date.now()-lastSavedAt>1500)) {
        storePosition();lastSavedAt=Date.now();
      }
    }
    requestRender();
  }

  function ensureEngine():NarrationController|null {
    if(!supported) {notice='此浏览器不支持系统语音，请使用新版 Chrome 或 Edge。';requestRender();return null;}
    if(engine) return engine;
    engine=new NarrationController(createOwnedSpeechPort(window.speechSynthesis),text=>new SpeechSynthesisUtterance(text),onSnapshot);
    engine.setRate(preferences.rate);engine.setVolume(preferences.volume);
    applyVoice();
    return engine;
  }

  function applyVoice() {
    if(!engine) return;
    let voice:SpeechSynthesisVoice|null=null;
    if(preferences.voiceId!==null) voice=voices.find(v=>v.voiceURI===preferences.voiceId)||null;
    else voice=voices.find(v=>/^zh[-_]CN$/i.test(v.lang)&&/natural|neural|online|自然/i.test(v.name))||voices.find(v=>/^zh[-_]CN$/i.test(v.lang))||voices.find(v=>/^zh/i.test(v.lang))||null;
    engine.setVoice(voice);
  }

  function bind(message:ChatMessage):NarrationController|null {
    const reader=ensureEngine();
    if(!reader) return null;
    if(bound?.id===message.id&&boundRoute===route&&bound.text===message.text) {bound=message;return reader;}
    storePosition();
    bound=message;boundRoute=route;lastHighlighted='';
    reader.setDocument(message.text,messageKey(message.id));
    const saved=preferences.positions[messageKey(message.id)];
    reader.seek(saved?.signature===contentSignature(message.text)?saved.progress:0);
    return reader;
  }

  function choose(id:string,scroll=true) {
    cancelPicking();
    const message=messages.find(entry=>entry.id===id);
    if(!message) return;
    if(selectedId!==id) {storePosition();engine?.stop();bound=null;clearHighlights();lastHighlighted='';}
    selectedId=id;
    preferences.selectedByConversation[route]=id;
    expand(message,!message.isStreaming);queueSave();
    if(scroll) message.element.scrollIntoView({behavior:'smooth',block:'start'});
    notice=message.isStreaming?'这条回答还在生成，完成后即可朗读。':null;
    requestRender();
  }

  function play() {
    const message=selected();
    if(!message) {notice='先打开一段已有回答，或从目录选择一条。';requestRender();return;}
    if(message.isStreaming) {notice='回答还在生成，请完成后再开始朗读。';requestRender();return;}
    expand(message);
    bind(message)?.play();
  }

  function seek(progress:number) {
    const message=selected();
    if(!message||message.isStreaming) return;
    bind(message)?.seek(progress);storePosition();
    highlightParagraph(message,snapshot.currentOffset,preferences.follow);
    requestRender();
  }

  function jumpSection(id:string,offset:number) {
    if(selectedId!==id) choose(id,false);
    const message=selected();
    if(!message||message.isStreaming) return;
    expand(message);seek(offset/Math.max(1,message.text.length));
    const paragraph=message.paragraphs[paragraphIndex(message,offset)];
    paragraph?.element.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function jumpParagraph(delta:number) {
    const message=selected();
    if(!message||message.isStreaming||!message.paragraphs.length) return;
    const saved=preferences.positions[messageKey(message.id)];
    const offset=bound?.id===message.id&&boundRoute===route?snapshot.currentOffset:
      saved?.signature===contentSignature(message.text)?Math.floor(saved.progress*message.text.length):0;
    const current=paragraphIndex(message,offset);
    const next=Math.max(0,Math.min(message.paragraphs.length-1,current+delta));
    jumpSection(message.id,message.paragraphs[next].start);
  }

  function render() {
    renderFrame=0;if(disposed) return;
    const message=selected();
    const ownsCurrent=!!message&&bound?.id===message.id&&boundRoute===route&&snapshot.documentId===messageKey(message.id);
    const saved=message?preferences.positions[messageKey(message.id)]:null;
    const progress=ownsCurrent?snapshot.progress:(saved?.signature===contentSignature(message?.text||'')?saved.progress:0);
    const offset=ownsCurrent?snapshot.currentOffset:Math.floor(progress*(message?.text.length||0));
    const paragraph=message?paragraphIndex(message,offset):-1;
    const sections=message?.paragraphs.filter(p=>/^H[1-6]$/.test(p.element.tagName)).map(p=>({messageId:message.id,title:p.text,offset:p.start,level:Number(p.element.tagName[1])})).slice(0,50)||[];
    const state:PanelState={
      messages:messages.map(entry=>({id:entry.id,title:entry.title,charCount:entry.charCount,collapsed:isCollapsed(entry),isStreaming:entry.isStreaming})),
      selectedId,activeTitle:message?.title||'选择一条回答开始阅读',supported,
      isPlaying:ownsCurrent&&snapshot.isPlaying,isPaused:ownsCurrent&&snapshot.isPaused,
      progress,
      rate:engine?snapshot.rate:preferences.rate,volume:engine?snapshot.volume:preferences.volume,
      voices:voices.map(voice=>({voiceURI:voice.voiceURI,name:voice.name,lang:voice.lang})),voiceId:engine?snapshot.voiceId:preferences.voiceId||'',
      error:ownsCurrent?snapshot.error:null,autoCollapse:preferences.autoCollapse,follow:preferences.follow,notice,
      currentParagraph:message?(offset>=message.text.length?message.paragraphs.length:Math.max(1,paragraph+1)):0,
      totalParagraphs:message?.paragraphs.length||0,sections,
    };
    panel?.update(state);
  }

  function requestRender() {if(!renderFrame&&!disposed) renderFrame=requestAnimationFrame(render);}

  function cancelPicking() {
    picking=false;pickStyle?.remove();pickStyle=null;
    document.documentElement.removeAttribute('data-tj-picking');
  }

  function startPicking() {
    if(picking) {cancelPicking();notice='已取消点选。';requestRender();return;}
    picking=true;
    document.documentElement.setAttribute('data-tj-picking','true');
    pickStyle=document.createElement('style');pickStyle.dataset.tjHelper='pick-style';
    pickStyle.textContent='html[data-tj-picking] main .markdown,html[data-tj-picking] main .prose,html[data-tj-picking] [data-testid^="conversation-turn-"]{cursor:crosshair!important}html[data-tj-picking] main .markdown:hover,html[data-tj-picking] main .prose:hover{outline:2px dashed #ce704f;outline-offset:6px}';
    document.head.append(pickStyle);
    notice='请点击左侧想读的回答正文，按 Esc 可以取消。';requestRender();
  }

  function pickClicked(event:MouseEvent) {
    if(!picking||!(event.target instanceof Element)||event.target.closest('#tingjian-chat-reader-ui')) return;
    event.preventDefault();event.stopImmediatePropagation();
    const message=pickMessageAt(event.target);
    if(!message) {notice='请点击回答的正文段落，避开输入框、链接和操作按钮。';requestRender();return;}
    pickedMessage=message;
    cancelPicking();rescan();choose(message.id,false);
    notice=message.isStreaming?'已选中这条回答，生成完成后即可朗读。':'已选中这条回答，点击「开始朗读」即可。';requestRender();
  }

  function pickKeydown(event:KeyboardEvent) {
    if(!picking||event.key!=='Escape') return;
    event.preventDefault();event.stopImmediatePropagation();cancelPicking();notice='已取消点选。';requestRender();
  }

  function rescan() {
    scanTimer=null;if(disposed) return;
    if(location.pathname!==route) {
      cancelPicking();pickedMessage=null;
      storePosition();engine?.stop();bound=null;selectedId='';lastHighlighted='';clearHighlights();cleanupDecorations();
      route=location.pathname;notice=null;
    }
    messages=scanMessages();
    if(pickedMessage) {
      pickedMessage=pickedMessage.element.isConnected?pickMessageAt(pickedMessage.contentElement):null;
      if(pickedMessage&&!messages.some(message=>message.element===pickedMessage?.element||message.contentElement===pickedMessage?.contentElement)) {
        messages.push(pickedMessage);
        messages.sort((a,b)=>a.element.compareDocumentPosition(b.element)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
      }
    }
    if(!messages.some(message=>message.id===selectedId)) {
      if(bound&&bound.id===selectedId) {storePosition();engine?.stop();bound=null;clearHighlights();lastHighlighted='';}
      selectedId=messages.find(m=>m.id===preferences.selectedByConversation[route])?.id||messages[messages.length-1]?.id||'';
    }
    const current=messages.find(m=>m.id===selectedId);
    if(bound&&boundRoute===route&&current?.id===bound.id) {
      if(current.text===bound.text) {
        const replaced=current.contentElement!==bound.contentElement||current.paragraphs.some((paragraph,index)=>paragraph.element!==bound?.paragraphs[index]?.element);
        bound=current;
        if(replaced&&(snapshot.isPlaying||snapshot.isPaused)) {
          clearHighlights();lastHighlighted='';
          highlightParagraph(current,snapshot.currentOffset,preferences.follow&&snapshot.isPlaying);
        }
      }
      else {
        storePosition();
        const wasReading=snapshot.isPlaying||snapshot.isPaused;
        engine?.stop();bound=null;
        if(wasReading) notice='这条回答内容已更新，朗读已停止，请重新开始。';
      }
    }
    for(const message of messages) decorate(message);
    requestRender();
  }

  function scheduleScan() {
    // Keep a bounded delay even when ChatGPT continuously changes its DOM.
    if(scanTimer||idleScan!==null) return;
    scanTimer=setTimeout(()=>{
      scanTimer=null;
      if('requestIdleCallback' in window) idleScan=window.requestIdleCallback(()=>{idleScan=null;rescan();},{timeout:1200});
      else rescan();
    },250);
  }

  panel=mountPanel({
    onPickMessage:startPicking,onClose:()=>{if(picking){cancelPicking();notice='已取消点选。';requestRender();}},
    onSelect:id=>choose(id),
    onTogglePlay:()=>{if(snapshot.isPlaying&&bound?.id===selectedId){engine?.pause();storePosition();}else play();},
    onStop:()=>{const message=selected();engine?.stop();clearHighlights();lastHighlighted='';if(message) {preferences.positions[messageKey(message.id)]={signature:contentSignature(message.text),progress:0};queueSave();}requestRender();},
    onSeek:seek,onPreviousParagraph:()=>jumpParagraph(-1),onNextParagraph:()=>jumpParagraph(1),onJumpSection:jumpSection,
    onRate:rate=>{preferences.rate=Math.max(0.5,Math.min(2.5,rate));engine?.setRate(preferences.rate);queueSave();requestRender();},
    onVolume:volume=>{preferences.volume=Math.max(0,Math.min(1,volume));engine?.setVolume(preferences.volume);queueSave();requestRender();},
    onVoice:id=>{preferences.voiceId=id;applyVoice();queueSave();requestRender();},
    onAutoCollapse:value=>{preferences.autoCollapse=value;queueSave();for(const message of messages) decorate(message);requestRender();},
    onFollow:value=>{preferences.follow=value;if(value&&snapshot.isPlaying){const message=selected();if(message){highlightParagraph(message,snapshot.currentOffset,true);}}queueSave();requestRender();},
    onExpandAll:()=>{for(const message of messages){preferences.collapsed[messageKey(message.id)]=false;decorate(message,false);}queueSave();requestRender();},
    onCollapseAll:()=>{if(snapshot.isPlaying) preferences.follow=false;for(const message of messages){if(message.charCount>=LONG_MESSAGE_THRESHOLD&&!message.isStreaming){preferences.collapsed[messageKey(message.id)]=true;decorate(message,true);}}queueSave();requestRender();},
    onRefresh:()=>{rescan();notice=messages.length?'目录已刷新，点击回答标题即可选中。':'尚未识别到回答。可点击「点选页面回答」，再点左侧正文。';requestRender();},
  });

  // Document reading remains available even if the optional system-voice API fails.
  rescan();
  document.addEventListener('click',pickClicked,true);
  document.addEventListener('keydown',pickKeydown,true);

  function loadVoices() {
    if(!supported) return;
    try {voices=window.speechSynthesis.getVoices().slice().sort((a,b)=>Number(/^zh/i.test(b.lang))-Number(/^zh/i.test(a.lang))||a.name.localeCompare(b.name));}
    catch {voices=[];notice='系统音色暂时无法读取，目录与点选仍可使用。';requestRender();return;}
    if(engine) applyVoice();requestRender();
  }
  if(supported) {
    loadVoices();
    try {window.speechSynthesis.addEventListener?.('voiceschanged',loadVoices);} catch {/* Optional voice discovery must not block reading. */}
  }
  const observer=new MutationObserver(records=>{
    if(records.every(record=>{
      const element=record.target.nodeType===Node.ELEMENT_NODE?record.target as Element:record.target.parentElement;
      if(element?.closest('[data-tj-helper],#tingjian-chat-reader-ui,input,textarea,[contenteditable="true"],[role="textbox"],#prompt-textarea')) return true;
      if(record.type==='attributes'&&(record.attributeName==='class'||record.attributeName==='style')) {
        if(record.attributeName==='class'&&(record.oldValue||'').split(/\s+/).includes('result-streaming')!==!!element?.classList.contains('result-streaming')) return false;
        const stop='[data-testid="stop-button"],[data-testid="stop-generating-button"],button[aria-label*="Stop generating"],button[aria-label*="Stop streaming"],button[aria-label*="停止生成"],button[aria-label*="停止回复"]';
        return !messages.some(message=>message.isStreaming)||!(element?.matches(stop)||element?.querySelector(stop));
      }
      return false;
    })) return;
    scheduleScan();
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeOldValue:true,
    attributeFilter:['data-is-streaming','data-streaming','data-is-last-node','data-status','aria-busy','hidden','aria-hidden','aria-label','data-testid','class','style']});
  const routeInterval=setInterval(()=>{if(location.pathname!==route) rescan();},700);
  window.addEventListener('popstate',scheduleScan);
  const onOpen=()=>panel.setOpen(true);
  const host=document.getElementById('tingjian-chat-reader-ui');
  host?.addEventListener('tingjian:open',onOpen);
  const runtime=extensionApi()?.runtime;
  const runtimeListener:RuntimeListener=(message,sender,reply)=>{
    if(!runtime?.id||sender.id!==runtime.id||!message||typeof message!=='object'||(message as {type?:string}).type!=='OPEN_PANEL') return;
    panel.setOpen(true);reply({ok:true});
  };
  runtime?.onMessage?.addListener(runtimeListener);

  function destroy() {
    if(disposed) return;
    storePosition();disposed=true;cancelPicking();engine?.dispose();observer.disconnect();clearInterval(routeInterval);
    if(scanTimer) clearTimeout(scanTimer);if(saveTimer) clearTimeout(saveTimer);if(renderFrame) cancelAnimationFrame(renderFrame);
    if(idleScan!==null) window.cancelIdleCallback(idleScan);
    void savePreferences(preferences).catch(()=>{});
    if(supported) window.speechSynthesis.removeEventListener?.('voiceschanged',loadVoices);
    document.removeEventListener('click',pickClicked,true);document.removeEventListener('keydown',pickKeydown,true);
    window.removeEventListener('popstate',scheduleScan);window.removeEventListener('pagehide',pageHide);
    runtime?.onMessage?.removeListener(runtimeListener);host?.removeEventListener('tingjian:open',onOpen);
    cleanupDecorations();clearHighlights();panel.destroy();delete window.__tingjianChatReader;
  }
  function pageHide(event:PageTransitionEvent) {if(event.persisted){engine?.pause();storePosition();void savePreferences(preferences).catch(()=>{});}else destroy();}
  window.addEventListener('pagehide',pageHide);
  window.__tingjianChatReader={open:onOpen,destroy};
  if(pendingOpen) panel.setOpen(true);
}

void startReader().catch(()=>{
  delete window.__tingjianChatReader;
  console.warn('听笺阅读助手启动失败，请刷新页面后重试。');
});
