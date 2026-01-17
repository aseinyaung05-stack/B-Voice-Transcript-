
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { AppState, TranscriptionSegment } from './types';
import { createPcmBlob } from './services/audioUtils';

// Constants
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE = 16000;

// Detailed System Instruction for high-quality Myanmar transcription
const MYANMAR_SYSTEM_INSTRUCTION = `
You are a highly skilled Professional Myanmar (Burmese) Stenographer and Linguistic Expert. 
Your sole objective is to provide a 100% accurate, word-for-word transcription of spoken Burmese audio into clean Myanmar Unicode text.

Rules for Transcription:
1. SCRIPT: Use standard Myanmar Unicode script only.
2. ACCURACY: Pay extreme attention to phonetic nuances, especially the differences between similar sounding consonants (e.g., က, ခ, ဂ) and complex vowels/tones.
3. CLEANUP: Intelligently remove verbal fillers (like "err", "uhm", "ah") and stutters while preserving the intended meaning.
4. GRAMMAR: Ensure proper Myanmar grammar and sentence structure. If the user speaks informally, transcribe it into standard written-style Burmese if appropriate for clarity.
5. PUNCTUATION: Use Myanmar punctuation ( ၊ and ။ ) naturally at the end of phrases and sentences.
6. NO CHATTER: Do not respond to the user, do not greet, and do not provide explanations. Output ONLY the transcribed text.
7. LANGUAGE: The user will speak in Burmese. Focus on the Myanmar language context.
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

  // Auto-scroll transcription
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
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
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
            // Smaller buffer for more frequent updates and lower latency
            const scriptProcessor = audioCtx.createScriptProcessor(2048, 1, 1);
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
            // Handle transcriptions
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              setCurrentDraft(prev => prev + text);
            }

            if (message.serverContent?.turnComplete) {
              setCurrentDraft(prev => {
                if (prev.trim()) {
                  setTranscriptions(list => [
                    ...list,
                    {
                      id: crypto.randomUUID(),
                      text: prev.trim(),
                      timestamp: Date.now(),
                      type: 'user'
                    }
                  ]);
                }
                return '';
              });
            }
          },
          onerror: (e: any) => {
            console.error('Session Error:', e);
            setErrorMessage('အမှားတစ်ခု ဖြစ်ပွားခဲ့သည်။ ကျေးဇူးပြု၍ ပြန်လည်ကြိုးစားပါ။');
            stopSession();
          },
          onclose: () => {
            setAppState(AppState.IDLE);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: MYANMAR_SYSTEM_INSTRUCTION
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      setErrorMessage('မိုက်ခရိုဖုန်း အသုံးပြုခွင့် မရပါ။');
      setAppState(AppState.IDLE);
    }
  }, [stopSession]);

  const copyAllText = () => {
    const fullText = transcriptions.map(t => t.text).join('\n');
    navigator.clipboard.writeText(fullText);
    alert('စာသားများကို ကူးယူပြီးပါပြီ။');
  };

  const saveAsWord = () => {
    if (transcriptions.length === 0) {
      alert('သိမ်းဆည်းရန် စာသားမရှိသေးပါ။');
      return;
    }

    const dateStr = new Date().toLocaleDateString();
    const content = transcriptions.map(t => `
      <div style="margin-bottom: 15px;">
        <p style="font-family: 'Padauk', sans-serif; font-size: 14pt; color: #333; line-height: 1.6;">${t.text}</p>
        <p style="font-size: 8pt; color: #888;">${new Date(t.timestamp).toLocaleTimeString()}</p>
      </div>
    `).join('');

    const header = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Myanmar Transcription - ${dateStr}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Padauk&display=swap');
          body { font-family: 'Padauk', 'Arial Unicode MS', sans-serif; }
        </style>
      </head>
      <body>
        <h1 style="color: #4f46e5; text-align: center;">နေ့စဉ် အသံဖမ်းမှတ်တမ်း</h1>
        <p style="text-align: center; color: #666;">ရက်စွဲ: ${dateStr}</p>
        <hr/>
        <div style="margin-top: 20px;">
          ${content}
        </div>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', header], {
      type: 'application/msword'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Myanmar_Transcription_${dateStr.replace(/\//g, '-')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    if (confirm('မှတ်တမ်းအားလုံးကို ဖျက်လိုပါသလား?')) {
      setTranscriptions([]);
      setCurrentDraft('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#f0f4f8] text-slate-900 p-4 md:p-8">
      {/* Header */}
      <header className="w-full max-w-3xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-indigo-700 tracking-tight flex items-center gap-2">
            <span className="bg-indigo-700 text-white p-1 rounded-lg">B</span>
            Voice Scribe
          </h1>
          <p className="text-slate-500 text-sm mt-1 myanmar-text font-semibold">မြန်မာအသံမှ စာသားသို့ ပြောင်းလဲခြင်း</p>
        </div>
        <div className="flex gap-1 md:gap-3">
          <button 
            onClick={copyAllText}
            className="p-3 rounded-xl bg-white shadow-sm hover:bg-slate-50 transition-all text-slate-600 border border-slate-200"
            title="Copy all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          </button>
          <button 
            onClick={saveAsWord}
            className="p-3 rounded-xl bg-indigo-50 shadow-sm hover:bg-indigo-100 transition-all text-indigo-700 border border-indigo-100"
            title="Save as Word"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
          <button 
            onClick={clearAll}
            className="p-3 rounded-xl bg-red-50 shadow-sm hover:bg-red-100 transition-all text-red-600 border border-red-100"
            title="Clear all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-3xl flex-1 flex flex-col gap-6 relative">
        <div 
          ref={scrollRef}
          className="flex-1 glass-panel rounded-[2rem] p-6 md:p-12 shadow-2xl shadow-indigo-100/50 overflow-y-auto max-h-[65vh] border border-white"
        >
          {transcriptions.length === 0 && !currentDraft && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-6 opacity-80">
              <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div className="text-center space-y-2">
                <p className="myanmar-text text-xl font-bold text-indigo-600">အသံဖမ်းယူရန် အသင့်ဖြစ်ပါသည်</p>
                <p className="myanmar-text text-slate-400">ခလုတ်ကို နှိပ်ပြီး မြန်မာလို စကားပြောနိုင်ပါပြီ။</p>
              </div>
            </div>
          )}

          <div className="space-y-8">
            {transcriptions.map((t) => (
              <div key={t.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex gap-4">
                  <div className="w-1 bg-indigo-200 rounded-full"></div>
                  <div>
                    <p className="myanmar-text text-2xl text-slate-800 leading-[1.8] font-medium tracking-wide">
                      {t.text}
                    </p>
                    <span className="text-[11px] text-slate-400 font-mono mt-2 block tracking-widest uppercase">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {currentDraft && (
              <div className="flex gap-4 transition-opacity duration-300">
                <div className="w-1 bg-indigo-500 animate-pulse rounded-full"></div>
                <div>
                  <p className="myanmar-text text-2xl text-indigo-600 leading-[1.8] italic animate-pulse opacity-80">
                    {currentDraft}...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-6 py-4 rounded-2xl text-md myanmar-text font-bold text-center animate-in slide-in-from-top-4 shadow-sm">
            ⚠️ {errorMessage}
          </div>
        )}
      </main>

      {/* Persistent Controls */}
      <footer className="w-full max-w-3xl flex flex-col items-center gap-6 mt-10 sticky bottom-8">
        <div className="flex items-center gap-8 bg-white/90 backdrop-blur-xl px-10 py-6 rounded-[3rem] shadow-2xl border border-white">
          <button
            onClick={appState === AppState.LISTENING ? stopSession : startSession}
            disabled={appState === AppState.CONNECTING}
            className={`
              relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-500 transform active:scale-90
              ${appState === AppState.LISTENING 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-[0_0_30px_rgba(239,68,68,0.4)]' 
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-[0_0_30px_rgba(79,70,229,0.4)]'}
              ${appState === AppState.CONNECTING ? 'opacity-50 cursor-wait' : ''}
            `}
          >
            {appState === AppState.CONNECTING ? (
              <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : appState === AppState.LISTENING ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}

            {/* Ripple Effects when listening */}
            {appState === AppState.LISTENING && (
              <>
                <div className="absolute inset-0 rounded-full animate-ping bg-red-400/40 -z-10"></div>
                <div className="absolute inset-0 rounded-full animate-pulse bg-red-400/20 -z-10 scale-150"></div>
              </>
            )}
          </button>

          <div className="flex flex-col min-w-[140px]">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Current Status</span>
            <span className={`text-sm font-bold flex items-center gap-2 mt-1 ${appState === AppState.LISTENING ? 'text-red-500' : 'text-slate-600'}`}>
              {appState === AppState.LISTENING && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>}
              <span className="myanmar-text font-bold">
                {appState === AppState.IDLE && 'အသင့်ရှိနေသည်'}
                {appState === AppState.CONNECTING && 'စတင်နေသည်...'}
                {appState === AppState.LISTENING && 'နားထောင်နေသည်...'}
              </span>
            </span>
          </div>
        </div>
        
        <div className="flex flex-col items-center gap-2 opacity-60">
          <p className="text-[10px] text-slate-500 uppercase tracking-[0.4em] font-black">AI Powered Transcription</p>
          <div className="flex gap-1">
            <div className="w-1 h-1 bg-indigo-400 rounded-full"></div>
            <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce"></div>
            <div className="w-1 h-1 bg-indigo-400 rounded-full"></div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
