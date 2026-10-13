import { describe, it, expect } from 'vitest';
import { acceptedGuidance, nextPassengerField, nextInstruction, reviewedTranscript } from '@/components/voice/passengerGuidance';
import { validatePassengerField, validateName } from '@/assistant/passengers/validate';
import { ConversationStore } from '@/assistant/context/store';
import { speakableText, spokenSentences } from '@/components/voice/lang';
import { speechSummary } from '@/components/voice/speechSummary';
describe('new prompt: accepted passenger guidance', () => {
 it('asks name, age and gender in sequence', () => {
  expect(nextPassengerField([])?.field).toBe('name');
  expect(nextPassengerField([{name:'सीता शर्मा'}])?.field).toBe('age');
  expect(nextPassengerField([{name:'सीता शर्मा',age:25}])?.field).toBe('gender');
 });
 it('confirms actual changed fields including edits, not expected fields', () => {
  expect(acceptedGuidance([],[{name:'Sita'}])).toContain('Naam: Sita');
  expect(acceptedGuidance([{name:'Sita',age:25}],[{name:'Sita',age:26}])).toContain('Umar: 26');
  expect(acceptedGuidance([{name:'Sita',age:25}],[{name:'Sita',age:25,gender:'female'}])).toContain('Gender: female');
  expect(acceptedGuidance([{name:'Sita'}],[{name:'Sita'}])).toBeNull();
  expect(acceptedGuidance([{}],[{age:200}])).toBeNull();
 });
 it('uses no-berth requirements and never offers food support', () => {
  const p = {name:'Baby',age:2,gender:'other' as const,category:'infant_without_berth' as const};
  expect(nextPassengerField([p])).toBeNull();
  expect(nextInstruction([p])).toContain('supported nahi');
  expect(validatePassengerField('food','Veg').ok).toBe(false);
 });
 it('keeps reviewed STT literal and ambiguous values invalid', () => {
  expect(validateName('सीता शर्मा').ok).toBe(true);
  expect(reviewedTranscript('age','२८')).toBe('28');
  expect(validatePassengerField('age','twenty or thirty').ok).toBe(false);
  expect(validatePassengerField('gender','maybe male').ok).toBe(false);
 });
 it('preserves decimal/date/train facts and long responses', () => {
  const text='Train 12014 on 2026-10-14. Fare ₹123.45; उपलब्धता unverified.';
  const clean=speakableText(text);
  expect(spokenSentences(clean).join(' ')).toBe(clean);
  expect(clean).toContain('123.45');
  expect(speechSummary({text:'A'.repeat(1600)})).toHaveLength(1600);
  expect(speakableText('{"tool":"UPDATE_PASSENGER","ok":true}')).toBe('');
 });
 it('removes only the requested passenger and invalidates review', () => {
  const store=new ConversationStore(); const c=store.getOrCreate('voice-test-001');
  c.selection={trainNumber:'12014',classCode:'CC',selectedAt:new Date().toISOString()};
  c.passengers=[{name:'Adult',age:30},{name:'Child',age:8},{name:'Baby',age:2,category:'infant_without_berth'}];
  expect(store.removePassenger(c.id,2).ok).toBe(true);
  expect(c.passengers.map(p=>p.name)).toEqual(['Adult','Baby']);
  expect(store.removePassenger(c.id,3).ok).toBe(false);
  expect(store.updatePassenger(c.id,2,{age:5}).ok).toBe(false);
  expect(store.updatePassenger(c.id,2,{berth:'Lower'}).ok).toBe(false);
 });
});
