import type { Approver, Flag, PriceOption, PricingRecord, Proposal } from '../../server/types';

export type { Approver, Flag, PriceOption, Proposal };
export type ProposalView = Proposal & { pricing: PricingRecord | null };
export const PLANNER = 'planner';

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'The server could not complete that request.');
  return body as T;
}

export const get = <T,>(path: string) => fetch(`/api${path}`).then((r) => parse<T>(r));
export const post = <T,>(path: string, body: unknown = {}) =>
  fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => parse<T>(r));
export const uploadBrief = <T,>(file: File) => {
  const form = new FormData();
  form.append('file', file);
  return fetch('/api/briefs/file', { method: 'POST', body: form }).then((r) => parse<T>(r));
};

export function inr(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
export function crore(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `₹${(value / 10000000).toFixed(2)} cr`;
}
export const rateLabel = (rate: number, unit: string) => (unit === 'per_impression' ? `₹${rate} /imp` : `₹${rate.toLocaleString('en-IN')} /10s`);
export const words = (text: string) => text.replace(/_/g, ' ');

const STATUS_TONES: Record<string, string> = {
  accepted: 'ok', approved: 'ok', decided: 'ok', acknowledged: 'ok', removed: 'ok', within: 'ok',
  in_review: 'accent', awaiting_confirmation: 'warn', open: 'warn', pending_planner: 'warn', pending_second_approver: 'warn', info: 'warn', under: 'warn',
  rejected: 'bad', refused: 'bad', over: 'bad',
};
export const tone = (status: string) => STATUS_TONES[status] ?? '';
