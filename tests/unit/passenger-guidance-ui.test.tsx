// @vitest-environment jsdom
import React from 'react';
import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';
const mocks=vi.hoisted(()=>({speak:vi.fn(),stop:vi.fn(),cancel:vi.fn(),start:vi.fn(),transcript:null as null|((t:string)=>void)}));
vi.mock('@/components/voice/useSpeak',()=>({useSpeak:()=>({supported:true,speakingId:null,error:null,speak:mocks.speak,stop:mocks.stop})}));
vi.mock('@/components/voice/useVoiceInput',()=>({useVoiceInput:(opts:{onTranscript:(t:string)=>void})=>{mocks.transcript=opts.onTranscript;return {supported:true,state:'idle',message:null,start:mocks.start,cancel:mocks.cancel};}}));
import {PassengerVoiceGuide} from '@/components/PassengerVoiceGuide';
import {act} from '@testing-library/react';
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();localStorage.clear();});
afterEach(cleanup);
describe('passenger voice UI offline',()=>{
 it('opens once; rerenders and reopening do not repeat; gender confirmation follows saved state',async()=>{
  const save=vi.fn();
  const props={conversationId:'session-ui-1',passengers:[{name:'Sita',age:25}],blocked:false,onSave:save};
  const view=render(<PassengerVoiceGuide {...props}/>);
  await waitFor(()=>expect(mocks.speak).toHaveBeenCalledTimes(1));
  expect(mocks.speak.mock.calls[0][1]).toContain('gender select');
  view.rerender(<PassengerVoiceGuide {...props}/>);
  expect(mocks.speak).toHaveBeenCalledTimes(1);
  view.rerender(<PassengerVoiceGuide {...props} passengers={[{name:'Sita',age:25,gender:'female'}]}/>);
  await waitFor(()=>expect(mocks.speak).toHaveBeenCalledTimes(2));
  expect(mocks.speak.mock.calls[1][1]).toContain('Gender: female');
  view.unmount();render(<PassengerVoiceGuide {...props}/>);
  expect(mocks.speak).toHaveBeenCalledTimes(2);
 });
 it('requires explicit transcript review; rejects ambiguity; manual edits invalidate proposal',async()=>{
  const save=vi.fn();const props={conversationId:'session-ui-2',passengers:[{name:'Sita'}],blocked:false,onSave:save};
  const view=render(<PassengerVoiceGuide {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Speak Umar'}));
  act(()=>mocks.transcript?.('twenty or thirty'));
  fireEvent.click(screen.getByRole('button',{name:'Use reviewed value'}));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Review spoken Umar'),{target:{value:'28'}});
  view.rerender(<PassengerVoiceGuide {...props} blocked/>);
  expect(screen.queryByRole('button',{name:'Use reviewed value'})).toBeNull();
  expect(save).not.toHaveBeenCalled();
 });
 it('saves only reviewed target and waits for snapshot before confirming',()=>{
  const save=vi.fn();render(<PassengerVoiceGuide conversationId="session-ui-3" passengers={[]} blocked={false} onSave={save}/>);
  fireEvent.click(screen.getByRole('button',{name:'Speak Naam'}));
  act(()=>mocks.transcript?.('सीता शर्मा'));
  fireEvent.click(screen.getByRole('button',{name:'Use reviewed value'}));
  expect(save).toHaveBeenCalledWith(1,'name','सीता शर्मा');
  expect(mocks.speak.mock.calls.every(call=>!call[1].includes('save hua'))).toBe(true);
 });
 it('respects audio opt-out',async()=>{
  localStorage.setItem('railsaarthi.autospeak','off');
  render(<PassengerVoiceGuide conversationId="session-ui-4" passengers={[]} blocked={false} onSave={vi.fn()}/>);
  expect(mocks.speak).not.toHaveBeenCalled();
 });
});
