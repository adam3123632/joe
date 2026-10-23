import {useCallback, useEffect, useRef, useState} from 'react';
import {emptyNarrationSnapshot, NarrationController} from '../lib/speech';
import type {NarrationSnapshot} from '../lib/speech';

const PREFERENCES_KEY = 'tingjian.narration.v1';
interface NarrationPreferences {rate: number; volume: number; voiceId: string | null; lastAudibleVolume: number;}

function readPreferences(): NarrationPreferences {
  const defaults: NarrationPreferences = {rate: 1, volume: 1, voiceId: null, lastAudibleVolume:1};
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      rate: typeof saved.rate === 'number' && Number.isFinite(saved.rate) ? Math.min(2.5, Math.max(0.5, saved.rate)) : 1,
      volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 1,
      voiceId: typeof saved.voiceId === 'string' && saved.voiceId.length <= 500 ? saved.voiceId : null,
      lastAudibleVolume: typeof saved.lastAudibleVolume === 'number' && Number.isFinite(saved.lastAudibleVolume) && saved.lastAudibleVolume > 0 ? Math.min(1,saved.lastAudibleVolume) : typeof saved.volume === 'number' && saved.volume > 0 ? Math.min(1,saved.volume) : 1,
    };
  } catch {return defaults;}
}

function preferredChineseVoice(voices: SpeechSynthesisVoice[]) {
  const score = (voice: SpeechSynthesisVoice) => {
    const chinese = voice.lang.toLowerCase().startsWith('zh');
    return (chinese ? 100 : 0) + (/^zh[-_](cn|hans)/i.test(voice.lang) ? 20 : 0)
      + (/natural|neural|online|自然|神经/i.test(voice.name) ? 12 : 0)
      + (/xiaoxiao|yunxi|xiaoyi|google.*中文/i.test(voice.name) ? 5 : 0)
      + (voice.default ? 1 : 0);
  };
  return voices.filter(voice => /^zh/i.test(voice.lang)).slice().sort((a,b) => score(b)-score(a))[0] || null;
}

export function useNarrator(text: string, documentId: string) {
  const [initialPreferences] = useState(readPreferences);
  const preferences = useRef(initialPreferences);
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [snapshot, setSnapshot] = useState<NarrationSnapshot>({...emptyNarrationSnapshot, rate:initialPreferences.rate, volume:initialPreferences.volume});
  const engine = useRef<NarrationController | null>(null);
  const currentDocument = useRef({text, documentId});
  currentDocument.current = {text, documentId};

  useEffect(() => {
    const available = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    setSupported(available);
    if (!available) return;
    const synthesis = window.speechSynthesis;
    const controller = new NarrationController(synthesis, value => new SpeechSynthesisUtterance(value), setSnapshot);
    engine.current = controller;
    controller.setDocument(currentDocument.current.text, currentDocument.current.documentId);
    controller.setRate(preferences.current.rate);
    controller.setVolume(preferences.current.volume);
    const loadVoices = () => {
      const list = synthesis.getVoices().slice().sort((a, b) => Number(b.lang.startsWith('zh')) - Number(a.lang.startsWith('zh')) || a.name.localeCompare(b.name));
      setVoices(list);
      const wanted = preferences.current.voiceId;
      controller.setVoice(wanted !== null ? list.find(voice => voice.voiceURI === wanted) || null : preferredChineseVoice(list));
    };
    loadVoices();
    synthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      synthesis.removeEventListener('voiceschanged', loadVoices);
      controller.dispose();
      if (engine.current === controller) engine.current = null;
    };
  }, []);

  useEffect(() => { engine.current?.setDocument(text, documentId); }, [text, documentId]);
  const play = useCallback(() => engine.current?.play(), []);
  const pause = useCallback(() => engine.current?.pause(), []);
  const toggle = useCallback(() => engine.current?.toggle(), []);
  const stop = useCallback(() => engine.current?.stop(), []);
  const seek = useCallback((progress: number) => engine.current?.seek(progress), []);
  const remember = useCallback((patch: Partial<NarrationPreferences>) => {
    preferences.current = {...preferences.current, ...patch};
    try {localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences.current));} catch { /* Storage is optional for playback. */ }
  }, []);
  const setRate = useCallback((rate: number) => {
    if (!Number.isFinite(rate)) return;
    const value=Math.min(2.5,Math.max(0.5,rate));
    engine.current?.setRate(value);
    remember({rate:value});
  }, [remember]);
  const setVolume = useCallback((volume: number) => {
    if (!Number.isFinite(volume)) return;
    const value=Math.min(1,Math.max(0,volume));
    engine.current?.setVolume(value);
    remember(value > 0 ? {volume:value,lastAudibleVolume:value} : {volume:0});
  }, [remember]);
  const toggleMute = useCallback(() => {
    const current=engine.current?.getSnapshot().volume ?? preferences.current.volume;
    setVolume(current > 0 ? 0 : preferences.current.lastAudibleVolume);
  }, [setVolume]);
  const setVoiceId = useCallback((id: string) => {
    remember({voiceId:id});
    engine.current?.setVoice(voices.find(voice => voice.voiceURI === id) || null);
  }, [voices,remember]);

  return {supported, voices, ...snapshot, play, pause, toggle, stop, seek, setRate, setVolume, toggleMute, setVoiceId};
}
