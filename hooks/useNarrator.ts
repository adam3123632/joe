import {useCallback, useEffect, useRef, useState} from 'react';
import {emptyNarrationSnapshot, NarrationController} from '../lib/speech';
import type {NarrationSnapshot} from '../lib/speech';

export function useNarrator(text: string, documentId: string) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [snapshot, setSnapshot] = useState<NarrationSnapshot>({...emptyNarrationSnapshot});
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
    const loadVoices = () => {
      const list = synthesis.getVoices().slice().sort((a, b) => Number(b.lang.startsWith('zh')) - Number(a.lang.startsWith('zh')) || a.name.localeCompare(b.name));
      setVoices(list);
      if (!controller.getSnapshot().voiceId) {
        const preferred = list.find(voice => voice.lang === 'zh-CN') || list.find(voice => voice.lang.startsWith('zh'));
        if (preferred) controller.setVoice(preferred);
      }
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
  const setRate = useCallback((rate: number) => engine.current?.setRate(rate), []);
  const setVoiceId = useCallback((id: string) => {
    engine.current?.setVoice(voices.find(voice => voice.voiceURI === id) || null);
  }, [voices]);

  return {supported, voices, ...snapshot, play, pause, toggle, stop, seek, setRate, setVoiceId};
}
