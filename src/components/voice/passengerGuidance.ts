import { requiredFieldsFor, type PassengerDraft } from '@/assistant/context/store';
import { validatePassengerField } from '@/assistant/passengers/validate';

export const FIELD_LABELS: Record<string, string> = { name: 'Naam', age: 'Umar', gender: 'Gender', berth: 'Berth preference', category: 'Passenger type', nationality: 'Nationality' };
export function nextPassengerField(passengers: PassengerDraft[]) {
  const list = passengers.length ? passengers : [{}];
  for (let i = 0; i < list.length; i++) {
    for (const field of requiredFieldsFor(list[i])) {
      if (list[i][field] === undefined || !validatePassengerField(field, list[i][field]).ok) return { index: i + 1, field };
    }
  }
  return null;
}
export function nextInstruction(passengers: PassengerDraft[]) {
  const next = nextPassengerField(passengers);
  if (!next) return 'Required details complete hain. Food preference is integration mein supported nahi hai. Details review kar sakte hain; booking abhi disabled hai.';
  const question: Record<string, string> = {
    name: 'poora naam batayein ya type karein.', age: 'journey date par completed years mein umar batayein.',
    gender: 'gender select karein: male, female, ya other.', berth: 'berth preference chunein, ya No Preference. Yeh request hai, allotment ki guarantee nahi.',
  };
  return `Passenger ${next.index}: ${question[next.field] ?? `${FIELD_LABELS[next.field]} bharein.`}`;
}
/** Compare accepted session snapshots only. Never infer a save from an expected field. */
export function acceptedGuidance(before: PassengerDraft[], after: PassengerDraft[]) {
  if (after.length < before.length) return nextInstruction(after);
  const confirmations: string[] = [];
  after.forEach((p, i) => {
    for (const field of ['name', 'age', 'gender', 'berth', 'category', 'nationality'] as const) {
      if (p[field] !== before[i]?.[field] && p[field] !== undefined && validatePassengerField(field, p[field]).ok) {
        const value = field === 'category' ? (p.category === 'infant_without_berth' ? 'under 5, without separate berth' : p.category === 'infant_with_berth' ? 'under 5, separate berth requested' : 'passenger') : String(p[field]);
        confirmations.push(`Passenger ${i + 1}, ${FIELD_LABELS[field]}: ${value}, save hua.`);
      }
    }
  });
  return confirmations.length ? `${confirmations.join(' ')} ${nextInstruction(after)}` : null;
}
export function reviewedTranscript(field: string, text: string) {
  let value = text.trim();
  if (field === 'age') value = value.replace(/[०-९]/g, c => String(c.charCodeAt(0) - 0x966));
  if (field === 'gender') value = ({ पुरुष: 'male', महिला: 'female', अन्य: 'other' } as Record<string,string>)[value] ?? value;
  return value;
}
