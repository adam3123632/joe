import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ReadingIcon as Icon} from './components/ReadingIcon';
import {useNarrator} from './hooks/useNarrator';
import {createDocument, loadDocuments, saveDocuments, type ReadingDocument} from './lib/documents';
import {createShareUrl, parseShareHash} from './lib/share';
import './styles.css';

type Modal = 'editor' | 'share' | 'help' | 'delete' | null;
const MAX_TEXT = 120_000;
const lengthOf = (text: string) => Array.from(text.replace(/\s/g, '')).length;
const formatTime = (seconds: number) => `${Math.floor(Math.max(0,seconds)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
const inferTitle = (text: string) => text.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim().slice(0,40) || '未命名稿件';

export default function App() {
  const [initial] = useState(() => loadDocuments());
  const [documents,setDocuments] = useState<ReadingDocument[]>(initial.documents);
  const [selectedId,setSelectedId] = useState(() => {
    try {
      const previous=localStorage.getItem('tingjian.current.v1');
      if(initial.documents.some(doc => doc.id === previous)) return previous!;
    } catch { /* Reading still works when browser storage is unavailable. */ }
    return initial.documents[0]?.id || '';
  });
  const [shared,setShared] = useState<ReadingDocument | null>(null);
  const [view,setView] = useState<'all' | 'recent'>('all');
  const [query,setQuery] = useState('');
  const [modal,setModal] = useState<Modal>(null);
  const [editingId,setEditingId] = useState<string | null>(null);
  const [draftTitle,setDraftTitle] = useState('');
  const [draftContent,setDraftContent] = useState('');
  const [shareUrl,setShareUrl] = useState('');
  const [shareError,setShareError] = useState('');
  const [sharing,setSharing] = useState(false);
  const [fontSize,setFontSize] = useState(18);
  const [toast,setToast] = useState<{text:string;error:boolean} | null>(null);
  const [storageError,setStorageError] = useState(initial.error || '');
  const fileInput = useRef<HTMLInputElement>(null);
  const shareInput = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistAllowed = useRef(!initial.error);
  const active = (shared?.id === selectedId ? shared : documents.find(doc => doc.id === selectedId)) || null;
  const narrator = useNarrator(active?.content || '',active?.id || 'empty');
  const latest = useRef({documents,active,progress:narrator.progress});
  latest.current = {documents,active,progress:narrator.progress};
  const visibleDocuments = useMemo(() => documents.filter(doc => (view !== 'recent' || doc.progress > 0) && `${doc.title}\n${doc.content}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)),[documents,view,query]);
  const paragraphs = useMemo(() => Array.from((active?.content || '').matchAll(/[^\n]+/g)).filter(match => match[0].trim()).map(match => ({text:match[0],start:match.index!,end:match.index!+match[0].length})),[active?.content]);

  function notify(text:string,error=false) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({text,error});
    toastTimer.current = setTimeout(() => setToast(null),4500);
  }
  useEffect(() => {
    if (!persistAllowed.current) return;
    const timer = setTimeout(() => setStorageError(saveDocuments(documents).error || ''),400);
    return () => clearTimeout(timer);
  },[documents]);
  useEffect(() => {
    let cancelled = false;
    async function loadShared() {
      try {
        const incoming = await parseShareHash(window.location.hash);
        if (!incoming || cancelled) return;
        narrator.stop();
        const doc = createDocument(incoming.title,incoming.content);
        doc.id = `shared-${doc.id}`;
        setShared(doc);setSelectedId(doc.id);
        notify('收到一篇分享稿件，点击播放就可以听了');
      } catch(error) {if(!cancelled) notify(error instanceof Error ? error.message : '分享链接无法读取',true);}
    }
    void loadShared();
    window.addEventListener('hashchange',loadShared);
    return () => {cancelled=true;window.removeEventListener('hashchange',loadShared);};
  },[]);
  useEffect(() => {narrator.seek(active?.progress || 0);},[active?.id]);
  useEffect(() => {
    if(active && narrator.documentId === active.id && narrator.progress === 1) recordProgress(1);
  },[active?.id,narrator.documentId,narrator.progress]);
  useEffect(() => {
    if(!active || active.id.startsWith('shared-')) return;
    try {localStorage.setItem('tingjian.current.v1',active.id);} catch { /* Main save reports storage failures. */ }
  },[active?.id]);
  useEffect(() => {
    if (!narrator.isPlaying) return;
    const interval = setInterval(() => {
      const state = latest.current;
      if (state.active && !state.active.id.startsWith('shared-')) setDocuments(prev => prev.map(doc => doc.id === state.active!.id ? {...doc,progress:state.progress} : doc));
    },2000);
    return () => clearInterval(interval);
  },[narrator.isPlaying]);
  useEffect(() => {
    const save = () => {
      narrator.pause();
      const state = latest.current;
      if (!persistAllowed.current || !state.active) return;
      saveDocuments(state.documents.map(doc => doc.id === state.active!.id ? {...doc,progress:state.progress} : doc));
    };
    window.addEventListener('pagehide',save);
    return () => {window.removeEventListener('pagehide',save);if(toastTimer.current) clearTimeout(toastTimer.current);};
  },[]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = modalRef.current;
    const frame = requestAnimationFrame(() => target?.querySelector<HTMLElement>('input, textarea, button')?.focus());
    const onKey = (event:KeyboardEvent) => {
      if(event.key === 'Escape') setModal(null);
      if(event.key !== 'Tab' || !target) return;
      const controls = Array.from(target.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href]'));
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();}
      if(!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',onKey);
    return () => {cancelAnimationFrame(frame);document.removeEventListener('keydown',onKey);previous?.focus();};
  },[modal]);

  function recordProgress(progress=narrator.progress) {
    if(!active) return;
    if(shared?.id === active.id) setShared(prev => prev ? {...prev,progress} : prev);
    else setDocuments(prev => prev.map(doc => doc.id === active.id ? {...doc,progress} : doc));
  }
  function selectDocument(doc:ReadingDocument) {
    if(doc.id === active?.id) return;
    recordProgress();narrator.stop();setSelectedId(doc.id);
  }
  function togglePlayback() {
    if(narrator.isPlaying) recordProgress();
    narrator.toggle();
  }
  function seek(progress:number) {
    const value=Math.max(0,Math.min(1,progress));
    narrator.seek(value);recordProgress(value);
  }
  function openEditor(doc?:ReadingDocument) {
    if(doc?.id === active?.id) {recordProgress();narrator.pause();}
    setEditingId(doc?.id || null);setDraftTitle(doc?.title || '');setDraftContent(doc?.content || '');setModal('editor');
  }
  async function pasteManuscript() {
    openEditor();
    try {
      if(!navigator.clipboard?.readText) throw new Error('unavailable');
      const text=await navigator.clipboard.readText();
      if(text.length > MAX_TEXT) {notify('请将长稿拆分为 12 万字以内的稿件',true);return;}
      setDraftContent(text);if(text.trim()) setDraftTitle(inferTitle(text));
    } catch {notify('请在稿件输入框中粘贴文字（Ctrl / ⌘ + V）');}
  }
  async function importFile(file?:File) {
    if(!file) return;
    if(!/\.(txt|md|markdown)$/i.test(file.name)) {notify('请导入 TXT 或 Markdown 文本文件',true);return;}
    if(file.size > 1024*1024) {notify('请导入 1 MB 以内的文本文件',true);return;}
    try {
      const content=(await file.text()).replace(/^\uFEFF/,'');
      if(!content.trim()) throw new Error('这个文件还没有文字');
      if(content.length > MAX_TEXT) throw new Error('请将长稿拆分为 12 万字以内的稿件');
      openEditor();setDraftTitle(file.name.replace(/\.(txt|md|markdown)$/i,''));setDraftContent(content);
    } catch(error) {notify(error instanceof Error ? error.message : '文件读取失败',true);}
  }
  function saveDraft(event:React.FormEvent) {
    event.preventDefault();
    if(!draftContent.trim()) return;
    const content=draftContent.trim(),title=draftTitle.trim() || inferTitle(content);
    const existing=documents.find(doc => doc.id === editingId);
    const doc=existing ? {...existing,title,content,progress:existing.content === content ? existing.progress : 0,updatedAt:new Date().toISOString()} : createDocument(title,content);
    const next=existing ? documents.map(item => item.id === doc.id ? doc : item) : [doc,...documents];
    const result=saveDocuments(next);
    if(!result.ok) {notify(result.error || '保存失败，请先导出备份',true);return;}
    narrator.stop();narrator.seek(doc.progress);persistAllowed.current=true;setDocuments(next);setSelectedId(doc.id);setShared(null);setModal(null);setView('all');setQuery('');setStorageError('');
    if(shared) history.replaceState(null,'',`${location.pathname}${location.search}`);
    notify(existing ? '修改已保存' : '稿件已存入你的书架');
  }
  function saveShared() {
    if(!active) return;
    const doc={...createDocument(active.title,active.content),progress:narrator.progress};
    const next=[doc,...documents],result=saveDocuments(next);
    if(!result.ok) {notify(result.error || '无法保存到此浏览器',true);return;}
    narrator.stop();persistAllowed.current=true;setDocuments(next);setShared(null);setSelectedId(doc.id);notify('分享稿件已存入你的书架');
    history.replaceState(null,'',`${location.pathname}${location.search}`);
  }
  async function openShare() {
    if(!active) return;
    setShareUrl('');setShareError('');setSharing(true);setModal('share');
    try {setShareUrl(await createShareUrl(active,window.location.href));}
    catch(error) {setShareError(error instanceof Error ? error.message : '链接生成失败');}
    finally {setSharing(false);}
  }
  async function copyShareLink() {
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareUrl);
      else {shareInput.current?.select();if(!document.execCommand('copy')) throw new Error('copy failed');}
      notify('分享链接已复制，发送给朋友就好');
    } catch {shareInput.current?.select();notify('请选中链接后手动复制');}
  }
  function exportDocument() {
    if(!active) return;
    const url=URL.createObjectURL(new Blob([`${active.title}\n\n${active.content}`],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`${active.title.replace(/[\\/:*?"<>|]/g,'_')}.txt`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),1000);notify('稿件已导出为文本文件');
  }
  function deleteDocument() {
    if(!active) return;
    narrator.stop();const next=documents.filter(doc => doc.id !== active.id);
    setDocuments(next);setSelectedId(next[0]?.id || '');setModal(null);notify('稿件已从书架移除');
  }
  const isShared=!!active && active.id === shared?.id;
  const localAddress=['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(window.location.hostname);
  const progress=narrator.progress;

  return <div className="app-shell">
    <aside className="sidebar" aria-label="主导航">
      <a className="brand" href="#" onClick={event => {event.preventDefault();setView('all');setQuery('');}} aria-label="听笺，我的书架"><span className="brand-mark"><Icon name="headphones"/></span><span><span className="brand-name">听笺<span className="brand-dot">.</span></span><span className="brand-caption">让每一页，都有声音</span></span></a>
      <div className="sidebar-label">我的空间 <span>WORKSPACE</span></div>
      <nav className="nav-list"><button className={`nav-item ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}><Icon name="library"/><span>我的书架</span><span className="library-count">{documents.length}</span></button><button className={`nav-item ${view === 'recent' ? 'active' : ''}`} onClick={() => setView('recent')}><Icon name="clock"/><span>继续收听</span></button></nav>
      <button className="create-button" onClick={() => openEditor()}><Icon name="plus"/><span>新建稿件</span></button>
      <div className="sidebar-note"><p>给眼睛一点留白，<br/>给文字一点声音。</p><small>把喜欢的文字，带进生活里。</small></div>
      <div className="side-footer"><button onClick={() => setModal('help')}><Icon name="help"/>使用指南</button><span>为文字留一点时间</span></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumbs">我的空间 <span>/</span><strong>{view === 'all' ? '我的书架' : '继续收听'}</strong></div><div className="topbar-actions"><span className="local-badge"><Icon name="lock"/>本地安心保存</span><button className="icon-button" onClick={() => setModal('help')} aria-label="查看使用指南"><Icon name="help"/></button><span className="avatar">读</span></div></header>
      <section className="hero" onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault();void importFile(event.dataTransfer.files[0]);}}>
        <div className="hero-copy"><div className="hero-eyebrow"><span/>SLOW DOWN. LISTEN IN.</div><h1 className="hero-title">让文字，<span>慢慢说给你听。</span></h1><p className="hero-subtitle">一篇好文章，一段自己的创作。<br className="mobile-break"/>粘贴进来，让每个字都有回响。</p><div className="hero-actions"><button className="primary-button" onClick={() => void pasteManuscript()}><Icon name="paste"/>粘贴稿件<Icon name="arrow"/></button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Icon name="upload"/>导入文件</button><span className="hero-file-hint">支持 TXT、Markdown</span></div></div>
        <div className="hero-decoration" aria-hidden="true"><div className="hero-sun"/><div className="hero-book hero-book-back"/><div className="hero-book hero-book-front"><span>把喜欢的文字<br/>读给生活听</span><i/><Icon name="leaf"/></div><span className="hero-spark">✦</span><span className="hero-small-note">a little space for your words</span></div>
      </section>
      <input ref={fileInput} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden aria-label="导入文本文件" onChange={event => {void importFile(event.target.files?.[0]);event.target.value='';}}/>
      {storageError && <div className="error-message" role="alert">{storageError} 请导出重要稿件备份。</div>}
      <div className="content-grid"><div className="main-column">
        <section className="library-section" aria-labelledby="library-title"><div className="section-heading"><div className="section-title"><h2 id="library-title">{view === 'all' ? '我的书架' : '继续收听'}</h2><span className="section-count">{visibleDocuments.length} 篇稿件</span></div><label className="search-box"><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索稿件" aria-label="搜索稿件"/></label></div>
          {visibleDocuments.length ? <div className="document-grid">{visibleDocuments.map((doc,index) => <button key={doc.id} className={`document-card ${active?.id === doc.id ? 'active-card' : ''}`} onClick={() => selectDocument(doc)} aria-label={`阅读 ${doc.title}`} aria-pressed={active?.id === doc.id}>
            <div className={`card-art card-art-${['peach','sage','lavender'][index%3]}`}><span className="card-tag">{doc.id.startsWith('sample') ? '听笺精选' : '我的稿件'}</span><div className="decorative-book"><Icon name={['leaf','book','note'][index%3]}/></div><span className="card-play"><Icon name={active?.id === doc.id && narrator.isPlaying ? 'volume' : 'play'}/></span></div>
            <div className="card-content"><h3 className="card-title">{doc.title}</h3><p className="card-excerpt">{doc.content.replace(/\n/g,' ')}</p><div className="card-footer"><span>{lengthOf(doc.content).toLocaleString()} 字 · 约 {Math.max(1,Math.ceil(lengthOf(doc.content)/230))} 分钟</span>{doc.progress > 0 ? <span className="card-progress">已听 {Math.round(doc.progress*100)}%</span> : <span>{new Date(doc.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</span>}</div></div>
          </button>)}</div> : <div className="empty-state"><Icon name={query ? 'search' : 'book'}/><h3>{query ? '还没找到这篇稿件' : view === 'recent' ? '留一点时间，开始听吧' : '你的第一篇稿件，从这里开始'}</h3><p>{query ? '换个关键词试试看。' : '粘贴 ChatGPT 中的文字，或导入一份文本文件。'}</p>{!query && <button className="secondary-button" onClick={() => openEditor()}><Icon name="plus"/>新建稿件</button>}</div>}
        </section>
        <section className="reader-panel" aria-labelledby="reader-title"><div className="reader-toolbar"><span className="reader-label"><span className={`reading-dot ${narrator.isPlaying ? 'is-live' : ''}`}/>{isShared ? '来自朋友的分享' : '沉浸阅读'}</span><div className="reader-tools"><button className="font-button" onClick={() => setFontSize(size => Math.max(14,size-2))} aria-label="缩小正文字号" disabled={fontSize <= 14}>A−</button><button className="font-button" onClick={() => setFontSize(size => Math.min(26,size+2))} aria-label="放大正文字号" disabled={fontSize >= 26}>A+</button><span className="tool-divider"/>{active && <><button className="icon-button" onClick={() => openEditor(active)} aria-label="编辑当前稿件"><Icon name="edit"/></button><button className="icon-button" onClick={exportDocument} aria-label="导出当前稿件"><Icon name="download"/></button>{!isShared && <button className="icon-button" onClick={() => setModal('delete')} aria-label="删除当前稿件"><Icon name="trash"/></button>}</>}</div></div>
          {active ? <><div className="reader-heading"><div className="document-meta"><span>{isShared ? '分享稿件' : '我的文字收藏'}</span><span>·</span><span>{lengthOf(active.content).toLocaleString()} 字</span><span>·</span><span>预计 {Math.max(1,Math.ceil(narrator.durationSeconds/60))} 分钟</span></div><h2 className="reader-title" id="reader-title">{active.title}</h2><div className="reader-byline"><span>用耳朵，重新认识这段文字</span>{isShared ? <button className="text-button" onClick={saveShared}><Icon name="plus"/>存入我的书架</button> : <span><Icon name="check"/>已存入书架</span>}</div></div><div className="reader-body" style={{fontSize}}>{paragraphs.map((paragraph,index) => <p className={`reader-paragraph ${(narrator.isPlaying || narrator.isPaused) && narrator.currentOffset >= paragraph.start && narrator.currentOffset < paragraph.end ? 'current-paragraph' : ''}`} key={index} role="button" tabIndex={0} title={`从第 ${index+1} 段开始朗读`} onClick={() => {narrator.seek(paragraph.start/active.content.length);narrator.play();}} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' ') {event.preventDefault();narrator.seek(paragraph.start/active.content.length);narrator.play();}}}>{paragraph.text}</p>)}</div><div className="reader-end"><span/>文字有尽，回响无穷<span/></div></> : <div className="reader-placeholder"><Icon name="book"/><h2 id="reader-title">让一段文字，陪伴此刻</h2><p>从书架选择一篇稿件，或粘贴你想听的文字。</p><button className="primary-button" onClick={() => openEditor()}>写下第一篇稿件</button></div>}
        </section><p className="workspace-footnote"><Icon name="lock"/>稿件保存在当前浏览器，重要内容记得导出备份。<span>MADE FOR SLOW MOMENTS</span></p>
      </div><aside className="player-column" aria-label="语音朗读播放器">
        <section className="player-panel"><div className="player-header"><span className="player-eyebrow"><Icon name="headphones"/>此刻，听一听</span><span className="status-pill">{narrator.isPlaying ? '正在朗读' : narrator.isPaused ? '已暂停' : '随时开始'}</span></div>
          <div className="player-illustration" aria-hidden="true"><div className="orbit-line"/><div className={`record-disc ${narrator.isPlaying ? 'spinning' : ''}`}><div className="record-inner"><div className="record-center"><Icon name="leaf"/></div></div></div><span className="floating-note note-one">♪</span><span className="floating-note note-two">✦</span></div>
          <div className="player-track"><p className="player-subtitle">正在收听 · YOUR READING MOMENT</p><h2 className="player-title">{active?.title || '等待一篇好文字'}</h2><span className="player-track-meta">{active ? `${lengthOf(active.content).toLocaleString()} 字 · 浏览器语音朗读` : '把想读的文字，留在这里'}</span></div>
          <div className="timeline"><label className="sr-only" htmlFor="reading-progress">朗读进度</label><input id="reading-progress" className="progress-slider" type="range" min="0" max="100" step="0.1" value={progress*100} disabled={!active} aria-valuetext={`已读 ${Math.round(progress*100)}%`} style={{'--progress':`${progress*100}%`} as React.CSSProperties} onChange={event => seek(Number(event.target.value)/100)}/><div className="times"><span>{formatTime(narrator.elapsedSeconds)}</span><span>{formatTime(narrator.durationSeconds)} <small>预计</small></span></div></div>
          <div className="player-controls"><button className="control-button" onClick={() => seek(progress-10/(narrator.durationSeconds || 1))} disabled={!active || !narrator.supported} aria-label="后退约10秒"><Icon name="back"/></button><button className="play-button" onClick={togglePlayback} disabled={!active || !narrator.supported} aria-label={narrator.isPlaying ? '暂停朗读' : narrator.isPaused ? '继续朗读' : '开始朗读'}><Icon name={narrator.isPlaying ? 'pause' : 'play'}/></button><button className="control-button" onClick={() => seek(progress+10/(narrator.durationSeconds || 1))} disabled={!active || !narrator.supported} aria-label="前进约10秒"><Icon name="forward"/></button></div>
          <div className="player-settings"><div className="volume-setting"><div className="setting-label"><label htmlFor="reading-volume">朗读音量</label><span className="volume-percent">{Math.round(narrator.volume*100)}%</span></div><div className="volume-controls"><button className="icon-button volume-mute" onClick={narrator.toggleMute} disabled={!narrator.supported} aria-label={narrator.volume === 0 ? '取消静音' : '静音'} aria-pressed={narrator.volume === 0} title={narrator.volume === 0 ? '恢复上次音量' : '静音'}><Icon name={narrator.volume === 0 ? 'muted' : 'volume'}/></button><button className="volume-step" onClick={() => narrator.setVolume((Math.round(narrator.volume*100)-10)/100)} disabled={!narrator.supported || narrator.volume === 0} aria-label="减小音量">−</button><input id="reading-volume" className="volume-slider" type="range" min="0" max="100" step="1" value={Math.round(narrator.volume*100)} aria-label="朗读音量" aria-valuetext={`${Math.round(narrator.volume*100)}%`} style={{'--volume':`${narrator.volume*100}%`} as React.CSSProperties} onChange={event => narrator.setVolume(Number(event.target.value)/100)} disabled={!narrator.supported}/><button className="volume-step" onClick={() => narrator.setVolume((Math.round(narrator.volume*100)+10)/100)} disabled={!narrator.supported || narrator.volume === 1} aria-label="增大音量">+</button></div><p className="volume-hint">网页音量可单独调节，最大响度由设备音量决定。</p></div><div className="setting-label"><span>朗读倍速</span><span>{narrator.rate}×</span></div><div className="speed-options">{[0.75,1,1.25,1.5,2].map(rate => <button key={rate} className={`speed-button ${narrator.rate === rate ? 'active' : ''}`} onClick={() => narrator.setRate(rate)} aria-pressed={narrator.rate === rate}>{rate}×</button>)}</div><label className="setting-label" htmlFor="reading-voice"><span>朗读声音</span><Icon name="volume"/></label><select id="reading-voice" className="voice-select" value={narrator.voiceId} onChange={event => narrator.setVoiceId(event.target.value)} disabled={!narrator.supported}><option value="">系统默认声音</option>{narrator.voices.map(voice => <option key={`${voice.voiceURI}-${voice.lang}`} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></div>
          {!narrator.supported ? <p className="error-message" role="alert">此浏览器不支持语音朗读，请使用新版 Chrome、Edge 或 Safari。</p> : narrator.error ? <p className="error-message" role="alert">{narrator.error}</p> : <p className="player-note"><Icon name="note"/>点击正文段落，也可以从那里开始听</p>}
        </section><section className="share-callout"><div className="share-callout-icon"><Icon name="share"/></div><h3>好文字，值得被听见。</h3><p>把这一篇分享给朋友，<br/>让声音连接彼此。</p><button className="secondary-button" onClick={() => void openShare()} disabled={!active}>分享这篇稿件<Icon name="arrow"/></button></section>
      </aside></div>
    </main>
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}><Icon name={toast.error ? 'help' : 'check'}/>{toast.text}<button aria-label="关闭提示" onClick={() => setToast(null)}><Icon name="close"/></button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => {if(event.target === event.currentTarget) setModal(null);}}><div ref={modalRef} className={`modal ${modal === 'editor' ? 'editor-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="modal-eyebrow">A PLACE FOR YOUR WORDS</span><h2 className="modal-title" id="modal-title">{modal === 'editor' ? editingId ? '编辑这篇稿件' : '收下一篇好文字' : modal === 'share' ? '让好文字，去到朋友身边' : modal === 'delete' ? '从书架移除这篇稿件？' : '把文字带进生活里'}</h2></div><button className="icon-button close-button" aria-label="关闭弹窗" onClick={() => setModal(null)}><Icon name="close"/></button></div>
      {modal === 'editor' && <form onSubmit={saveDraft}><p className="modal-hint">复制 ChatGPT 中的稿件，直接粘贴到这里。也可以写下你的新想法。</p><label className="field-label" htmlFor="draft-title">稿件标题 <span>留空时自动取首行</span></label><input className="input" id="draft-title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} maxLength={120} placeholder="给这段文字起个名字"/><label className="field-label" htmlFor="draft-content">稿件正文 <span>{lengthOf(draftContent).toLocaleString()} 字</span></label><textarea className="textarea" id="draft-content" value={draftContent} onChange={event => setDraftContent(event.target.value)} maxLength={MAX_TEXT} placeholder="在这里粘贴或输入你想听的文字…" required/><div className="modal-actions"><span className="modal-save-note"><Icon name="lock"/>保存在当前浏览器</span><button className="secondary-button" type="button" onClick={() => setModal(null)}>取消</button><button className="primary-button" type="submit"><Icon name="check"/>保存到书架</button></div></form>}
      {modal === 'share' && <div className="share-modal-content"><div className="share-preview"><Icon name="book"/><div><strong>{active?.title}</strong><span>{active ? lengthOf(active.content).toLocaleString() : 0} 字 · 打开即可阅读和收听</span></div></div><p className="modal-hint">将链接发给朋友，对方打开后点击播放，就能用自己设备上的声音朗读。</p>{sharing ? <p role="status">正在准备分享链接…</p> : shareError ? <p className="error-message" role="alert">{shareError}</p> : <><label className="field-label" htmlFor="share-link">稿件分享链接</label><div className="copy-field"><input id="share-link" ref={shareInput} className="input" value={shareUrl} readOnly onFocus={event => event.target.select()}/><button className="primary-button" onClick={() => void copyShareLink()} disabled={!shareUrl}><Icon name="copy"/>复制链接</button></div>{typeof navigator.share === 'function' && <button className="secondary-button native-share" onClick={() => void navigator.share({title:active?.title,url:shareUrl}).catch(error => {if(error.name !== 'AbortError') notify('系统分享暂不可用，请复制链接');})}><Icon name="share"/>更多分享方式</button>}</>}<p className="share-privacy"><Icon name="lock"/>链接包含稿件全文，获得链接的人都能查看。请确认内容适合分享。</p>{localAddress && <p className="error-message">当前网页运行在本地。部署到公开网址后，生成的链接才能供其他人打开。</p>}<div className="modal-actions"><button className="secondary-button" onClick={exportDocument}><Icon name="download"/>也可以导出 TXT</button></div></div>}
      {modal === 'delete' && <div><p className="modal-hint">「{active?.title}」将从此浏览器的书架中移除。需要留存时，可以先导出备份。</p><div className="modal-actions"><button className="secondary-button" onClick={exportDocument}><Icon name="download"/>先导出备份</button><button className="secondary-button" onClick={() => setModal(null)}>取消</button><button className="primary-button danger-button" onClick={deleteDocument}><Icon name="trash"/>确认移除</button></div></div>}
      {modal === 'help' && <div className="help-content"><div><span>01</span><h3>把稿件放进来</h3><p>复制 ChatGPT 中的文字，点击「粘贴稿件」，或导入 TXT、Markdown 文件。这里也可以直接写作。</p></div><div><span>02</span><h3>找到舒服的节奏</h3><p>点击播放开始听，随时暂停、拖动进度条、调整音量、倍速与声音。点击正文段落，可以从那一段接着听。时长为估算值，实际声音由设备提供。</p></div><div><span>03</span><h3>收藏，也分享</h3><p>稿件和阅读进度保存在当前浏览器，清理网站数据会移除它们，请定期导出备份。分享链接包含全文，朋友打开后即可朗读，也可以存入自己的书架。</p></div><div className="help-note"><Icon name="headphones"/>第一次播放需要手动点击。声音取决于系统已安装的语音；部分声音需要联网。</div><button className="primary-button" onClick={() => setModal(null)}>开始我的阅读时光<Icon name="arrow"/></button></div>}
    </div></div>}
  </div>;
}
