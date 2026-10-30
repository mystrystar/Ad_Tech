// M0: mock knowledge base lookups. Every vague term in a brief resolves through here.
import { mock } from '../data';
import type { GenreRequest, LengthRequest, Medium, Resolution } from '../types';

const kb = mock.knowledgeBase;

export function term(name: string): Resolution {
  return { term: name, meaning: kb.terms[name]?.meaning ?? 'Not defined in the knowledge base' };
}

export function budgetRules(text: string) {
  const lower = text.toLowerCase();
  const around = /\b(around|about|approx|approximately|roughly)\b/.test(lower);
  const allIn = /\ball[\s-]?in\b/.test(lower);
  return {
    around, allIn,
    tolerancePct: around ? kb.terms.around.tolerancePct! : 0,
    taxPct: allIn ? kb.terms['all in'].taxPct! : 0,
  };
}

export function expandRegions(text: string) {
  const lower = text.toLowerCase();
  const states = new Set<string>();
  const groups: string[] = [];
  for (const [group, members] of Object.entries(kb.regionGroups)) {
    if (lower.includes(group)) {
      groups.push(group);
      members.forEach((state) => states.add(state));
    }
  }
  for (const state of kb.states) if (lower.includes(state.toLowerCase())) states.add(state);
  return { states: [...states], groups };
}

const mediumFor = (genre: string): Medium => (genre === 'OTT' ? 'ott' : 'linear');

// "Strong GEC presence, some sports, and digital" -> GEC 60, Sports 15, OTT 25, rescaled to total 100.
export function resolveGenres(phrases: string[]): GenreRequest[] {
  const found: GenreRequest[] = [];
  const aliases = Object.keys(kb.genreAliases).sort((a, b) => b.length - a.length).join('|');
  const pattern = new RegExp(`(?:\\b(strong|some)\\s+)?\\b(${aliases})\\b`, 'gi');
  for (const match of phrases.join(', ').matchAll(pattern)) {
    const genre = kb.genreAliases[match[2].toLowerCase()];
    if (found.some((g) => g.genre === genre)) continue;
    const weight = kb.genreIntensity[match[1]?.toLowerCase() ?? 'default'];
    found.push({ raw: match[0], genre, medium: mediumFor(genre), sharePct: weight });
  }
  const total = found.reduce((sum, g) => sum + g.sharePct, 0);
  return found.map((g) => ({ ...g, sharePct: Math.round((g.sharePct / total) * 100) }));
}

// "Mostly 30 sec, a few 10s" -> 30 sec at 80%, 10 sec at 20%, rescaled to total 100.
export function resolveLengths(phrases: string[]): LengthRequest[] {
  const found: LengthRequest[] = [];
  const pattern = /(?:\b(mostly|few)\s+)?\b(\d{1,3})\s*(?:sec(?:ond)?s?|s)\b/gi;
  for (const match of phrases.join(', ').matchAll(pattern)) {
    const seconds = Number(match[2]);
    if (found.some((l) => l.seconds === seconds)) continue;
    const weight = kb.lengthIntensity[match[1]?.toLowerCase() ?? 'default'];
    found.push({ raw: match[0], seconds, sharePct: weight });
  }
  const total = found.reduce((sum, l) => sum + l.sharePct, 0);
  return found.map((l) => ({ ...l, sharePct: Math.round((l.sharePct / total) * 100) }));
}

export const reachFactor = (band: 'peak' | 'slow') => kb.timeBands[band].reachFactor;
export const knowledgeBase = kb;
