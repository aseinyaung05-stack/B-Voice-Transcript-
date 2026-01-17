
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { AppState, TranscriptionSegment } from './types';
import { createPcmBlob } from './services/audioUtils';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE = 16000;

const MYANMAR_SYSTEM_INSTRUCTION = `
Role: You are an Elite Myanmar Language Linguistic Expert and Real-time Stenography Engine.
Objective: Transcribe spoken Burmese audio into high-standard, grammatically correct Myanmar Unicode text.

LINGUISTIC PROTOCOLS:
1. ORTHOGRAPHIC CORRECTNESS: Resolve phonetic ambiguities using linguistic context. Distinguish between 'ရ' and 'ယ', or 'တ' and 'ဌ' based on word meaning.
2. UNICODE STORAGE ORDER: Strictly follow the Myanmar Unicode standard. The 'ေ' vowel MUST be stored AFTER the consonant in the logical string sequence (Consonant + Vowel order).
3. TONAL ACCURACY: Recognize Burmese tones (creaky, low, high/long) and apply correct tone markers (့, း) accordingly.
4. AUTO-CORRECTION: Clean up colloquial pronunciations and slurs into standard literary spelling (e.g., 'ကျွန်တော်' instead of 'ကျနော်' or 'ကျတော').
5. PUNCTUATION: Insert Myanmar commas ( ၊ ) and full stops ( ။ ) based on speech pauses and natural sentence closures.
6. NO FILLERS: Remove 'um', 'ah', stutters, and background noise from the output.
7. OUTPUT ONLY TEXT: Provide transcription text segments ONLY. Do not translate or comment.
`;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [transcriptions, setTranscriptions] = useState<TranscriptionSegment[]>([]);
  const [currentDraft, setCurrentDraft] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, currentDraft]);

  const stopSession = useCallback(async () => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      session.close();
      sessionPromiseRef.current = null;
    }
    setAppState(AppState.IDLE);
  }, []);

  const startSession = useCallback(async () => {
    try {
      setAppState(AppState.CONNECTING);
      setErrorMessage(null);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: SAMPLE_RATE } 
      });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            setAppState(AppState.LISTENING);
            const source = audioCtx.createMediaStreamSource(stream);
            const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              setCurrentDraft(prev => prev + text);
            }
            if (message.serverContent?.turnComplete) {
              setCurrentDraft(prev => {
                const trimmed = prev.trim();
                if (trimmed) {
                  setTranscriptions(list => [...list, { id: crypto.randomUUID(), text: trimmed, timestamp: Date.now(), type: 'user' }]);
                }
                return '';
              });
            }
          },
          onerror: (e: any) => {
            console.error('Session Error:', e);
            setErrorMessage('အမှားတစ်ခု ဖြစ်ပွားခဲ့ပါသည်။ ပြန်လည်စတင်ပေးပါ။');
            stopSession();
          },
          onclose: () => setAppState(AppState.IDLE)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: MYANMAR_SYSTEM_INSTRUCTION
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
      setErrorMessage('မိုက်ခရိုဖုန်း အသုံးပြုခွင့် မရှိပါ။');
      setAppState(AppState.IDLE);
    }
  }, [stopSession]);

  const saveAsWord = () => {
    if (transcriptions.length === 0) return alert('သိမ်းဆည်းရန် စာသားမရှိပါ။');
    const dateStr = new Date().toLocaleDateString();
    const content = transcriptions.map(t => `<p style="font-family: 'Padauk', sans-serif; font-size: 16pt; line-height: 2;">${t.text}</p><p style="font-size: 10pt; color: #888;">🕑 ${new Date(t.timestamp).toLocaleTimeString()}</p><br>`).join('');
    const header = `<html><head><meta charset='utf-8'><style>@import url('https://fonts.googleapis.com/css2?family=Padauk&display=swap'); body { font-family: 'Padauk', sans-serif; padding: 50px; }</style></head><body><h1 style="color: #4f46e5;">Burmese Voice Scribe Pro</h1>${content}</body></html>`;
    const blob = new Blob(['\ufeff', header], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Myanmar_Transcription_${dateStr}.doc`;
    link.click();
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#f8fafc] p-4 md:p-8">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8 bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-600 rounded-[1.25rem] flex items-center justify-center text-white font-black text-3xl shadow-lg">ဗ</div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Voice Scribe Pro</h1>
            <p className="text-indigo-500 text-[10px] font-black uppercase tracking-[0.3em] mt-1">Linguistic AI Engine</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { navigator.clipboard.writeText(transcriptions.map(t => t.text).join('\n')); alert('Copied!'); }} className="p-3 rounded-2xl border border-slate-100 text-slate-500 hover:bg-slate-50"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg></button>
          <button onClick={saveAsWord} className="p-3 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-md"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></button>
          <button onClick={() => confirm('Clear all?') && setTranscriptions([])} className="p-3 rounded-2xl border border-red-50 text-red-500 hover:bg-red-50"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
        </div>
      </header>

      <main className="w-full max-w-4xl flex-1 flex flex-col gap-6">
        <div ref={scrollRef} className="flex-1 bg-white rounded-[3rem] p-8 md:p-14 shadow-2xl overflow-y-auto max-h-[60vh] border border-slate-50 relative">
          {transcriptions.length === 0 && !currentDraft && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
              <h2 className="myanmar-text text-3xl font-black text-slate-700 mb-3">စကားပြောရန် အသင့်ဖြစ်သည်</h2>
              <p className="myanmar-text text-slate-500">သင်၏အသံကို AI က တိကျစွာ ပြောင်းလဲပေးပါမည်။</p>
            </div>
          )}
          <div className="space-y-10">
            {transcriptions.map((t) => (
              <div key={t.id} className="pl-10 relative border-l-2 border-slate-100 group">
                <div className="absolute left-[-5px] top-4 w-2.5 h-2.5 rounded-full bg-slate-200 group-hover:bg-indigo-500 transition-colors"></div>
                <p className="myanmar-text text-[1.8rem] text-slate-800 leading-[2.1] font-medium">{t.text}</p>
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{new Date(t.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
            {currentDraft && (
              <div className="pl-10 relative border-l-2 border-indigo-200">
                <div className="absolute left-[-5px] top-4 w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></div>
                <p className="myanmar-text text-[1.8rem] text-indigo-600 leading-[2.1] italic opacity-80">{currentDraft}<span className="inline-block w-1.5 h-9 bg-indigo-600 ml-2 animate-pulse align-middle rounded-full"></span></p>
              </div>
            )}
          </div>
        </div>
        {errorMessage && <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-8 py-5 rounded-[2rem] text-lg font-black animate-bounce">⚠️ {errorMessage}</div>}
      </main>

      <footer className="w-full max-w-4xl mt-10 sticky bottom-8">
        <div className="bg-white/90 backdrop-blur-3xl px-12 py-8 rounded-[4rem] shadow-2xl border border-white flex items-center justify-between">
          <div className="hidden lg:block pl-6">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">AI Status</h3>
            <p className="myanmar-text font-black text-slate-800 text-lg">အဆင့်မြင့်ဖမ်းယူမှု (Pro)</p>
          </div>
          <button onClick={appState === AppState.LISTENING ? stopSession : startSession} disabled={appState === AppState.CONNECTING} className={`relative flex items-center justify-center w-28 h-28 rounded-full transition-all duration-700 hover:scale-110 active:scale-95 shadow-2xl ${appState === AppState.LISTENING ? 'bg-red-600' : 'bg-indigo-600'} text-white`}>
            {appState === AppState.CONNECTING ? <div className="w-10 h-10 border-[5px] border-white/30 border-t-white rounded-full animate-spin"></div> : appState === AppState.LISTENING ? <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14" viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="5" width="10" height="10" rx="3" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}
            {appState === AppState.LISTENING && <div className="absolute inset-[-10px] rounded-full animate-ping bg-red-400/20 -z-10"></div>}
          </button>
          <div className="flex flex-col text-right min-w-[200px] pr-6">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Live Engine</span>
            <div className={`flex items-center justify-end gap-3 font-black myanmar-text text-lg ${appState === AppState.LISTENING ? 'text-red-600' : 'text-slate-700'}`}>{appState === AppState.LISTENING ? 'နားထောင်နေသည်...' : 'အသင့်ရှိနေသည်'}</div>
          </div>
        </div>
        <p className="mt-8 text-[10px] text-slate-400 uppercase tracking-widest text-center">Gemini 2.5 Flash Native Audio Engine</p>
      </footer>
    </div>
  );
};

export default App;
