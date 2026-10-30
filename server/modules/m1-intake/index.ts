// M1: any brief format -> one standard BriefRecord, with vague terms resolved through M0.
import type { BriefRecord, RawBrief, Resolution, SourceFormat, TargetMedium } from '../../types';
import { budgetRules, expandRegions, resolveGenres, resolveLengths, term } from '../m0-knowledge';
import { extractWithAgent } from './agent';
import { toText } from './parsers';

export async function intakeBrief(format: SourceFormat, input: Buffer): Promise<BriefRecord> {
  const text = await toText(format, input);
  let raw: RawBrief;
  let parsedBy: BriefRecord['parsedBy'] = 'agent';
  let parserNote: string | null = null;
  try {
    raw = await extractWithAgent(text);
  } catch (error) {
    raw = extractWithRules(text);
    parsedBy = 'fallback_rules';
    parserNote = `The AI agent was unavailable (${(error as Error).message}), so basic text rules read this brief. Check every field.`;
  }
  return resolveBrief(raw, { sourceFormat: format, parsedBy, parserNote, rawText: text });
}

// Used only when the agent call fails, so a brief is never lost. Handles plainly worded briefs.
function extractWithRules(text: string): RawBrief {
  const find = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;
  const sentence = (pattern: RegExp) => text.split(/[.\n]/).find((line) => pattern.test(line))?.trim() ?? null;
  const dates = text.match(/(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)\s+(?:to|-|–)\s+(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)/);
  return {
    agency: find(/^\s*agency\s*:\s*(.+)$/im),
    client: find(/^\s*client\s*:\s*(.+)$/im),
    category: find(/^\s*category\s*:\s*(.+)$/im) ?? find(/competing\s+(\w+)/i),
    budgetText: find(/budget[:\s]+([^\n]*?\d+(?:\.\d+)?\s*(?:cr|crore|lakh)[^.\n]*)/i),
    startDateText: dates?.[1] ?? null,
    endDateText: dates?.[2] ?? null,
    audience: find(/\b((?:women|men|adults)\s*\d{2}\s*-\s*\d{2})/i),
    nccsText: find(/\b(NCCS\s*[A-E]+)\b/i),
    regionTexts: expandRegions(text).states.length ? [sentence(/hindi belt|maharashtra|pradesh|delhi/i) ?? ''] : [],
    genrePhrases: [...text.matchAll(/\b(?:strong\s+|some\s+)?(?:gec|sports?|digital|ott|streaming)\b/gi)].map((m) => m[0]),
    adLengthPhrases: [...text.matchAll(/\b(?:mostly\s+|a\s+few\s+)?\d{1,3}\s*(?:sec(?:ond)?s?|s)\b/gi)].map((m) => m[0]),
    rateInstructionText: sentence(/\brates?\b/i),
    separationRuleText: sentence(/competing|same break/i),
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseDate(text: string | null): { iso: string | null; yearAssumed: boolean } {
  const match = text?.match(/(\d{1,2})\s*([A-Za-z]{3})[a-z]*(?:[\s,]+(\d{4}))?/);
  const month = match ? MONTHS.indexOf(match[2].toLowerCase()) : -1;
  if (!match || month < 0) return { iso: null, yearAssumed: false };
  const year = match[3] ?? String(new Date().getFullYear());
  return { iso: `${year}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`, yearAssumed: !match[3] };
}

function parseAmount(text: string | null): number | null {
  const match = text?.match(/(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lac)/i);
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2].toLowerCase().startsWith('cr') ? 10000000 : 100000));
}

export function budgetFields(raw: string | null, total: number | null, allIn: boolean, tolerancePct: number, taxPct: number): BriefRecord['budget'] {
  const mediaBudget = total === null ? null : Math.round(total / (1 + taxPct / 100));
  return {
    raw, total, allIn, taxPct, tolerancePct, mediaBudget,
    min: mediaBudget === null ? null : Math.round(mediaBudget * (1 - tolerancePct / 100)),
    max: mediaBudget === null ? null : Math.round(mediaBudget * (1 + tolerancePct / 100)),
  };
}

export function deriveTargetMedium(genres: BriefRecord['genres']): TargetMedium | null {
  const mediums = new Set(genres.map((g) => g.medium));
  if (mediums.size === 0) return null;
  return mediums.size === 2 ? 'both' : [...mediums][0];
}

export function missingFields(brief: Omit<BriefRecord, 'missingFields'>): string[] {
  const missing: string[] = [];
  if (!brief.agency) missing.push('agency');
  if (!brief.client) missing.push('client');
  if (!brief.category) missing.push('category');
  if (!brief.budget.total) missing.push('budget');
  if (!brief.startDate) missing.push('start date');
  if (!brief.endDate) missing.push('end date');
  if (!brief.audience) missing.push('audience');
  if (!brief.nccs.length) missing.push('NCCS');
  if (!brief.regions.states.length) missing.push('regions');
  if (!brief.genres.length) missing.push('genres');
  if (!brief.adLengths.length) missing.push('ad lengths');
  return missing;
}

// The agent sometimes returns the whole clause ("Women 25-44, NCCS AB, ..."), so keep only the audience group.
function normalizeAudience(text: string | null): string | null {
  const match = text?.match(/\b(women|men|adults)\s*(\d{2})\s*(?:-|–|to)\s*(\d{2})/i);
  if (!match) return text?.trim() || null;
  return `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}-${match[3]}`;
}

const singular = (word: string) => word.replace(/s$/i, '');
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

function resolveBrief(raw: RawBrief, source: Pick<BriefRecord, 'sourceFormat' | 'parsedBy' | 'parserNote' | 'rawText'>): BriefRecord {
  const resolutions: Resolution[] = [];
  const budgetText = raw.budgetText;
  const rules = budgetRules(budgetText ?? '');
  if (rules.around) resolutions.push(term('around'));
  if (rules.allIn) resolutions.push(term('all in'));

  const start = parseDate(raw.startDateText);
  const end = parseDate(raw.endDateText);
  if (start.yearAssumed || end.yearAssumed) resolutions.push({ term: 'dates with no year', meaning: 'A date with no year uses the current year' });

  const nccs = [...(raw.nccsText?.replace(/nccs/i, '').toUpperCase().match(/[A-E]/g) ?? [])];
  if (nccs.length) resolutions.push(term('nccs'));

  const regionText = raw.regionTexts.join(' + ');
  const regions = expandRegions(regionText);
  regions.groups.forEach((group) => resolutions.push(term(group)));

  const genres = resolveGenres(raw.genrePhrases);
  genres.forEach((g) => {
    if (g.genre === 'GEC') resolutions.push(term('gec'));
    if (g.genre === 'OTT') resolutions.push(term('digital'));
    resolutions.push({ term: g.raw, meaning: `${g.sharePct}% of media budget goes to ${g.genre}` });
  });

  const adLengths = resolveLengths(raw.adLengthPhrases);
  adLengths.forEach((l) => resolutions.push({ term: l.raw, meaning: `${l.sharePct}% of spots or impressions at ${l.seconds} sec` }));

  const rateRaw = raw.rateInstructionText;
  const blocked = raw.separationRuleText?.match(/competing\s+(\w+)/i)?.[1] ?? null;
  const partial = {
    ...source,
    agency: raw.agency,
    client: raw.client,
    category: raw.category ? title(singular(raw.category)) : blocked ? title(singular(blocked)) : null,
    budget: budgetFields(budgetText, parseAmount(budgetText), rules.allIn, rules.tolerancePct, rules.taxPct),
    startDate: start.iso,
    endDate: end.iso,
    audience: normalizeAudience(raw.audience),
    nccs,
    regions: { raw: raw.regionTexts, states: regions.states },
    genres,
    targetMedium: deriveTargetMedium(genres),
    adLengths,
    rateInstruction: { raw: rateRaw, type: /last year|previous year/i.test(rateRaw ?? '') ? 'same_as_last_year' as const : 'rate_card' as const },
    separationRule: { raw: raw.separationRuleText, blockedCategory: blocked ? title(singular(blocked)) : null, scope: 'same_break' as const },
    resolutions,
  };
  return { ...partial, missingFields: missingFields(partial) };
}
