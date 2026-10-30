// M4: PricingRecord -> PlanRecord. Splits budget by genre, favours reach per rupee, checks ad lengths per medium.
import { randomUUID } from 'node:crypto';
import { mock } from '../data';
import type { BriefRecord, BudgetStatus, GenreRequest, InventoryRecord, LengthCheck, Medium, PlanLine, PlanRecord, PriceOption, PricingRecord } from '../types';
import { reachFactor } from './m0-knowledge';

export const lengthKey = (medium: Medium, seconds: number) => `${medium}|${seconds}`;

export function lineAmount(line: Pick<PlanLine, 'medium' | 'units' | 'rate' | 'adLength'>) {
  return Math.round(line.medium === 'ott' ? line.units * line.rate : line.units * (line.adLength / 10) * line.rate);
}

export function budgetStatus(brief: BriefRecord, lines: PlanLine[]): BudgetStatus {
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const min = brief.budget.min!;
  const max = brief.budget.max!;
  return { total, target: brief.budget.mediaBudget!, min, max, state: total > max ? 'over' : total < min ? 'under' : 'within' };
}

export function checkAdLengths(brief: BriefRecord, lines: PlanLine[]): LengthCheck[] {
  const pairs = new Map<string, { medium: Medium; seconds: number }>();
  for (const genre of brief.genres) {
    for (const length of brief.adLengths) pairs.set(lengthKey(genre.medium, length.seconds), { medium: genre.medium, seconds: length.seconds });
  }
  for (const line of lines) pairs.set(lengthKey(line.medium, line.adLength), { medium: line.medium, seconds: line.adLength });
  return [...pairs.values()].map(({ medium, seconds }) => {
    const rule = mock.allowedLengths.find((a) => a.medium === medium)!;
    return { medium, seconds, minSeconds: rule.minSeconds, maxSeconds: rule.maxSeconds, ok: seconds >= rule.minSeconds && seconds <= rule.maxSeconds };
  }).sort((a, b) => a.medium.localeCompare(b.medium) || b.seconds - a.seconds);
}

// Assigns real inventory rows to lines, spread evenly across dates. Each linear break takes one spot from this brief.
export function assignSlots(lines: PlanLine[], inventory: InventoryRecord): string | null {
  const used = new Set<string>();
  const impressionsLeft = new Map<string, number>();
  const ordered = [...lines].sort((a, b) => b.adLength - a.adLength);
  for (const line of ordered) {
    const rows = inventory.free.filter((row) => row.channelId === line.channelId && row.timeBand === line.timeBand);
    if (line.medium === 'ott') {
      let remaining = line.units;
      line.slotIds = [];
      for (const row of rows) {
        if (remaining <= 0) break;
        const available = impressionsLeft.get(row.id) ?? row.impressionsAvailable ?? 0;
        if (available <= 0) continue;
        const taken = Math.min(available, remaining);
        impressionsLeft.set(row.id, available - taken);
        line.slotIds.push(row.id);
        remaining -= taken;
      }
      if (remaining > 0) return `${line.channelName} ${line.timeBand} does not have enough free impressions for this plan.`;
      continue;
    }
    const candidates = rows.filter((row) => !used.has(row.id) && (row.secondsAvailable ?? 0) >= line.adLength);
    if (candidates.length < line.units) return `${line.channelName} ${line.timeBand} has ${candidates.length} free breaks left for ${line.adLength} sec, and this line needs ${line.units}.`;
    line.slotIds = Array.from({ length: line.units }, (_, i) => candidates[Math.floor((i * candidates.length) / line.units)].id);
    line.slotIds.forEach((id) => used.add(id));
  }
  return null;
}

export function newLine(option: PriceOption, adLength: number, units: number): PlanLine {
  const line: PlanLine = {
    id: randomUUID(), channelId: option.channelId, channelName: option.channelName, genre: option.genre, medium: option.medium,
    timeBand: option.timeBand, adLength, unitType: option.medium === 'ott' ? 'impressions' : 'spots', units,
    rateUnit: option.rateUnit, cardRate: option.cardRate, rate: option.chosenRate, rateSource: option.rateSource, amount: 0, slotIds: [],
  };
  line.amount = lineAmount(line);
  return line;
}

const score = (option: PriceOption) => (option.reachThousands * reachFactor(option.timeBand)) / option.chosenRate;

function planLinear(genreBudget: number, options: PriceOption[], lengths: { seconds: number; sharePct: number }[], inventory: InventoryRecord) {
  const longest = Math.max(...lengths.map((l) => l.seconds));
  const capacity = (o: PriceOption) => inventory.free.filter((row) => row.channelId === o.channelId && row.timeBand === o.timeBand && (row.secondsAvailable ?? 0) >= longest).length;
  const avgSeconds = lengths.reduce((sum, l) => sum + (l.seconds * l.sharePct) / 100, 0);
  const totalScore = options.reduce((sum, o) => sum + score(o), 0);
  const ranked = [...options].sort((a, b) => score(b) - score(a));
  const spots = new Map<PriceOption, Map<number, number>>();
  let spent = 0;

  for (const option of ranked) {
    const share = genreBudget * (score(option) / totalScore);
    const count = Math.min(capacity(option), Math.floor(share / ((option.chosenRate * avgSeconds) / 10)));
    const byLength = new Map<number, number>();
    let left = count;
    lengths.forEach((length, index) => {
      const units = index === lengths.length - 1 ? left : Math.min(left, Math.round((count * length.sharePct) / 100));
      byLength.set(length.seconds, units);
      left -= units;
      spent += units * (length.seconds / 10) * option.chosenRate;
    });
    spots.set(option, byLength);
  }

  // Spend what proportional shares left over: longest ads first on the best-value options.
  const byLongest = [...lengths].sort((a, b) => b.seconds - a.seconds);
  for (const length of byLongest) {
    for (const option of ranked) {
      const cost = (length.seconds / 10) * option.chosenRate;
      const byLength = spots.get(option)!;
      let booked = [...byLength.values()].reduce((sum, n) => sum + n, 0);
      while (spent + cost <= genreBudget && booked < capacity(option)) {
        byLength.set(length.seconds, (byLength.get(length.seconds) ?? 0) + 1);
        spent += cost;
        booked++;
      }
    }
  }

  const lines: PlanLine[] = [];
  for (const [option, byLength] of spots) {
    for (const [seconds, units] of byLength) if (units > 0) lines.push(newLine(option, seconds, units));
  }
  return lines;
}

function planOtt(genreBudget: number, options: PriceOption[], lengths: { seconds: number; sharePct: number }[]) {
  const totalScore = options.reduce((sum, o) => sum + score(o), 0);
  const ranked = [...options].sort((a, b) => score(b) - score(a));
  const impressions = new Map(ranked.map((o) => [o, Math.min(o.freeUnits, Math.floor((genreBudget * (score(o) / totalScore)) / o.chosenRate))]));
  let spent = ranked.reduce((sum, o) => sum + impressions.get(o)! * o.chosenRate, 0);
  for (const option of ranked) {
    const extra = Math.min(option.freeUnits - impressions.get(option)!, Math.floor((genreBudget - spent) / option.chosenRate));
    if (extra > 0) {
      impressions.set(option, impressions.get(option)! + extra);
      spent += extra * option.chosenRate;
    }
  }
  const lines: PlanLine[] = [];
  for (const [option, total] of impressions) {
    let left = Math.floor(total / 1000) * 1000;
    lengths.forEach((length, index) => {
      const units = index === lengths.length - 1 ? left : Math.round((total * length.sharePct) / 100000) * 1000;
      left -= units;
      if (units > 0) lines.push(newLine(option, length.seconds, units));
    });
  }
  return lines;
}

function planGenre(genre: GenreRequest, brief: BriefRecord, pricing: PricingRecord, inventory: InventoryRecord, lengthDecisions: Record<string, 'keep' | 'remove'>): { lines: PlanLine[]; note?: string } {
  const options = pricing.options.filter((o) => o.genre === genre.genre);
  const genreBudget = (brief.budget.mediaBudget! * genre.sharePct) / 100;
  const lengths = brief.adLengths.filter((l) => lengthDecisions[lengthKey(genre.medium, l.seconds)] !== 'remove');
  if (!options.length) return { lines: [], note: `No free ${genre.genre} inventory was found for this brief.` };
  if (!lengths.length) return { lines: [], note: `All ${genre.genre} ad lengths were removed by the planner, so its budget is unspent.` };
  const totalShare = lengths.reduce((sum, l) => sum + l.sharePct, 0);
  const shares = lengths.map((l) => ({ seconds: l.seconds, sharePct: (l.sharePct / totalShare) * 100 }));
  return { lines: genre.medium === 'ott' ? planOtt(genreBudget, options, shares) : planLinear(genreBudget, options, shares, inventory) };
}

export function buildPlan(brief: BriefRecord, inventory: InventoryRecord, pricing: PricingRecord, lengthDecisions: Record<string, 'keep' | 'remove'>): PlanRecord {
  const lines: PlanLine[] = [];
  const notes: string[] = [];
  for (const genre of brief.genres) {
    const result = planGenre(genre, brief, pricing, inventory, lengthDecisions);
    lines.push(...result.lines);
    if (result.note) notes.push(result.note);
  }
  const shortfall = assignSlots(lines, inventory);
  if (shortfall) notes.push(shortfall);
  return { lines, budget: budgetStatus(brief, lines), lengthChecks: checkAdLengths(brief, lines), notes };
}
