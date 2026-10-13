"use client";
/* Snapshot effects synchronize the external session stream and browser audio preferences into transient guidance, not a second passenger store. */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';
import type { PassengerDraft } from '@/assistant/context/store';
import { validatePassengerField } from '@/assistant/passengers/validate';
import { useSpeak } from './voice/useSpeak';
import { useVoiceInput } from './voice/useVoiceInput';
import { acceptedGuidance, FIELD_LABELS, nextInstruction, nextPassengerField, reviewedTranscript } from './voice/passengerGuidance';

/** Only transient STT proposals live here; accepted passengers always come from the session. */
export function PassengerVoiceGuide({ conversationId, passengers, blocked, onSave }: {
  conversationId: string; passengers: PassengerDraft[]; blocked: boolean;
  onSave: (index: number, field: string, value: string) => void;
}) {
  const audio = useSpeak();
  const [enabled, setEnabled] = useState(false);
  const [lang, setLang] = useState('hi-IN');
  const [guidance, setGuidance] = useState('');
  const [announcement, setAnnouncement] = useState<{id: string; text: string} | null>(null);
  const delivered = useRef<string | null>(null);
  const [proposal, setProposal] = useState('');
  const [issue, setIssue] = useState('');
  const target = useRef<ReturnType<typeof nextPassengerField>>(null);
  const [reviewTarget, setReviewTarget] = useState<ReturnType<typeof nextPassengerField>>(null);
  const previous = useRef<PassengerDraft[] | null>(null);
  const serial = useRef(0);
  const latest = useRef({ blocked, conversationId });
  useEffect(() => { latest.current = { blocked, conversationId }; }, [blocked, conversationId]);
  const voice = useVoiceInput({ lang, onTranscript: text => {
    if (latest.current.blocked || !target.current) return;
    setProposal(reviewedTranscript(target.current.field, text));
    setReviewTarget(target.current);
    setIssue('Transcript check karein. Save karne se pehle correction kar sakte hain.');
  } });
  const cancelVoice = voice.cancel;
  const stopAudio = audio.stop;
  const speakAudio = audio.speak;
  useEffect(() => {
    try { setEnabled(localStorage.getItem('railsaarthi.autospeak') !== 'off'); } catch { setEnabled(true); }
    cancelVoice();
    previous.current = null;
    target.current = null;
    setReviewTarget(null); setProposal('');
    return stopAudio;
  }, [conversationId, stopAudio, cancelVoice]);
  useEffect(() => {
    const before = previous.current;
    const changed = before !== null && JSON.stringify(before) !== JSON.stringify(passengers);

    if (changed || blocked) { audio.stop(); voice.cancel(); target.current = null; setReviewTarget(null); setProposal(''); }
    if (blocked) { setAnnouncement(null); return; }
    previous.current = passengers.map(p => ({ ...p }));
    let text: string | null = null;
    if (before === null) {
      text = nextInstruction(passengers);
      let seen = false;
      try { seen = sessionStorage.getItem(`pax-guidance:${conversationId}`) === 'opened'; sessionStorage.setItem(`pax-guidance:${conversationId}`, 'opened'); } catch { /* in-memory guard still applies */ }
      setGuidance(text);
      if (seen) return;
    } else if (changed) text = acceptedGuidance(before, passengers);
    if (text) { setGuidance(text); setAnnouncement({id: `pax-${conversationId}-${++serial.current}`, text}); }
  // Snapshot effects intentionally do not replay on voice capability or preference changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers, blocked, conversationId]);
  useEffect(() => {
    if (!announcement || delivered.current === announcement.id || blocked || !enabled || !audio.supported || voice.state === 'recording') return;
    delivered.current = announcement.id;
    speakAudio(announcement.id, announcement.text);
  }, [announcement, blocked, enabled, audio.supported, speakAudio, voice.state]);
  const next = nextPassengerField(passengers);
  const recording = voice.state === 'recording' || voice.state === 'processing';
  return <section aria-label="Passenger voice guidance" className="rounded-xl border border-cream-300 bg-cream-100 p-4 space-y-3">
    <p role="status">{guidance || nextInstruction(passengers)}</p>
    <div className="flex flex-wrap gap-3">
      <label><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setAnnouncement(null); audio.stop(); try { localStorage.setItem('railsaarthi.autospeak', e.target.checked ? 'on' : 'off'); } catch {} }} /> Spoken guidance</label>
      <button type="button" disabled={!enabled || !audio.supported || blocked || recording} onClick={() => audio.speak(`repeat-${++serial.current}`, guidance || nextInstruction(passengers))}>Listen / retry</button>
      <button type="button" onClick={audio.stop}>Stop audio</button>
      <label>Voice input language<select value={lang} onChange={e => { voice.cancel(); setLang(e.target.value); }}><option value="hi-IN">Hindi / Hinglish</option><option value="en-IN">English (India)</option></select></label>
      <button type="button" disabled={blocked || !voice.supported || (!next && !recording)} onClick={() => {
        audio.stop(); setProposal(''); setReviewTarget(null); setIssue('');
        if (recording) { voice.cancel(); target.current = null; return; }
        target.current = next; voice.start();
      }}>{recording ? 'Cancel microphone' : `Speak ${next ? FIELD_LABELS[next.field] : 'details'}`}</button>
    </div>
    {!voice.supported && <p>Voice input unavailable. Type in the labelled fields below.</p>}
    {!audio.supported && <p>Audio unavailable. Text guidance remains available.</p>}
    {audio.speakingId && <p>Preparing or playing guidance…</p>}
    {(audio.error || voice.message || issue) && <p role="alert">{audio.error || voice.message || issue}</p>}
    {reviewTarget && <div className="space-y-2">
      <label>Review spoken {FIELD_LABELS[reviewTarget.field]}<input className="pax-input" value={proposal} onChange={e => setProposal(e.target.value)} /></label>
      <button type="button" disabled={blocked} onClick={() => {
        const checked = validatePassengerField(reviewTarget.field, proposal);
        if (!checked.ok) { setIssue(checked.error); return; }
        onSave(reviewTarget.index, reviewTarget.field, proposal);
        setProposal(''); setReviewTarget(null); target.current = null; setIssue('Saving; confirmation follows only after acceptance.');
      }}>Use reviewed value</button>
      <button type="button" onClick={() => { setProposal(''); setReviewTarget(null); target.current = null; setIssue(''); }}>Discard transcript</button>
    </div>}
  </section>;
}
