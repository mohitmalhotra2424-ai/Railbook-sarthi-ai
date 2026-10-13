// @vitest-environment jsdom
import {renderHook,act,waitFor,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useSpeak} from '@/components/voice/useSpeak';
import {useVoiceInput} from '@/components/voice/useVoiceInput';
const synth={speak:vi.fn(),cancel:vi.fn(),getVoices:()=>[],addEventListener:vi.fn(),removeEventListener:vi.fn(),speaking:false,pending:false};
beforeEach(()=>{
 vi.stubGlobal('speechSynthesis',synth);vi.clearAllMocks();
 vi.stubGlobal('SpeechSynthesisUtterance',class {text:string;constructor(t:string){this.text=t;}});
 vi.stubGlobal('fetch',vi.fn(async(_url:string,opts?:RequestInit)=>opts?.method==='POST'?new Response('audio',{headers:{'content-type':'audio/mpeg'}}):new Response(JSON.stringify({configured:true}))));
 URL.createObjectURL=vi.fn(()=> 'blob:fixture');URL.revokeObjectURL=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('deduplicates same pending message, uses fallback only once on dual playback failure',async()=>{
 vi.stubGlobal('Audio',class {onerror:(()=>void)|null=null;pause(){} play(){queueMicrotask(()=>this.onerror?.());return Promise.reject(new Error('blocked'));}});
 const {result}=renderHook(()=>useSpeak());
 act(()=>{result.current.speak('message','ट्रेन 12014 available nahi hai.');result.current.speak('message','ट्रेन 12014 available nahi hai.');});
 await waitFor(()=>expect(synth.speak).toHaveBeenCalledTimes(1));
 expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
});
it('interruption suppresses late server audio',async()=>{
 let resolve!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn((_url:string,opts?:RequestInit)=>opts?.method==='POST'?new Promise<Response>(r=>{resolve=r;}):Promise.resolve(new Response('{}'))));
 const play=vi.fn();vi.stubGlobal('Audio',class {pause(){} play=play;});
 const {result}=renderHook(()=>useSpeak());
 act(()=>result.current.speak('late','Hello'));
 act(()=>window.dispatchEvent(new Event('railsaarthi:listen-start')));
 await act(async()=>resolve(new Response('audio',{headers:{'content-type':'audio/mpeg'}})));
 expect(play).not.toHaveBeenCalled();expect(synth.speak).not.toHaveBeenCalled();
 expect(result.current.speakingId).toBeNull();
});
it('unavailable playback clears pending state and reports failure',async()=>{
 vi.stubGlobal('speechSynthesis',undefined);vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
 const {result}=renderHook(()=>useSpeak());act(()=>result.current.speak('failed','Hello'));
 await waitFor(()=>expect(result.current.error).toContain('available nahi'));
 expect(result.current.speakingId).toBeNull();
});
it('STT ignores interim results and callbacks from canceled recognition',()=>{
 const instances: Array<{onresult:((e:unknown)=>void)|null}>=[];
 vi.stubGlobal('SpeechRecognition',class {onresult=null;onend=null;onerror=null;start(){}stop(){}abort(){}constructor(){instances.push(this);}});
 const transcript=vi.fn();const {result}=renderHook(()=>useVoiceInput({lang:'hi-IN',onTranscript:transcript}));
 act(()=>result.current.start());
 const deliver=(isFinal:boolean)=>instances[0].onresult?.({resultIndex:0,results:[{isFinal,0:{transcript:'सीता शर्मा'}}]});
 act(()=>deliver(false));expect(transcript).not.toHaveBeenCalled();
 act(()=>deliver(true));expect(transcript).toHaveBeenCalledWith('सीता शर्मा');
 act(()=>result.current.cancel());act(()=>deliver(true));expect(transcript).toHaveBeenCalledTimes(1);
});
