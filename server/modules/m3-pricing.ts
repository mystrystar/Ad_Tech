// M3: InventoryRecord -> PricingRecord. Prices from the rate card, compares with last year, checks discount limits.
import { mock } from '../data';
import type { BriefRecord, InventoryRecord, PriceOption, PricingRecord, RateChoice, TimeBand } from '../types';

export const rateKey = (channelId: string, timeBand: TimeBand) => `${channelId}|${timeBand}`;

const roundPct = (value: number) => Math.round(value * 10) / 10;

export function discountPct(cardRate: number, rate: number) {
  return roundPct(((cardRate - rate) / cardRate) * 100);
}

export function limitFor(channelId: string, genre: string) {
  const channel = mock.discountLimits.find((d) => d.scope === 'channel' && d.key === channelId);
  const byGenre = mock.discountLimits.find((d) => d.scope === 'genre' && d.key === genre);
  return channel?.maxDiscountPct ?? byGenre?.maxDiscountPct ?? 0;
}

export function priceInventory(brief: BriefRecord, inventory: InventoryRecord, decisions: Record<string, RateChoice>): PricingRecord {
  const pricing: PricingRecord = { options: [], unpriced: [] };
  const lengths = brief.adLengths.map((l) => l.seconds);

  for (const { channel, reachThousands } of inventory.eligibleChannels) {
    for (const timeBand of ['peak', 'slow'] as TimeBand[]) {
      const rows = inventory.free.filter((row) => row.channelId === channel.id && row.timeBand === timeBand);
      if (!rows.length) continue;

      const validRates = mock.rateCard.filter((r) =>
        r.channelId === channel.id && r.timeBand === timeBand && r.validFrom <= brief.startDate! && r.validTo >= brief.endDate!);
      const card = validRates.find((r) => r.adLength !== null && lengths.includes(r.adLength)) ?? validRates[0];
      const cardRate = card?.ratePer10Sec ?? card?.ratePerImpression;
      if (cardRate === undefined) {
        pricing.unpriced.push({ channelId: channel.id, timeBand });
        continue;
      }

      const deal = brief.rateInstruction.type === 'same_as_last_year'
        ? mock.lastYearDeals.find((d) => d.agency === brief.agency && d.client === brief.client && d.channelId === channel.id && d.timeBand === timeBand)
        : undefined;
      const lastYearRate = deal?.ratePaid ?? null;
      const rateSource: RateChoice = decisions[rateKey(channel.id, timeBand)] ?? 'rate_card';
      const chosenRate = rateSource === 'last_year' && lastYearRate !== null ? lastYearRate : cardRate;
      const limitPct = limitFor(channel.id, channel.genre);
      const discount = discountPct(cardRate, chosenRate);
      const discountIfLastYearPct = lastYearRate === null ? null : discountPct(cardRate, lastYearRate);

      const option: PriceOption = {
        channelId: channel.id, channelName: channel.name, genre: channel.genre, medium: channel.medium, timeBand,
        rateUnit: channel.medium === 'ott' ? 'per_impression' : 'per_10_sec',
        cardRate, lastYearRate, chosenRate, rateSource,
        hasConflict: lastYearRate !== null && lastYearRate !== cardRate,
        limitPct, discountPct: discount, breach: discount > limitPct,
        discountIfLastYearPct, breachIfLastYear: discountIfLastYearPct !== null && discountIfLastYearPct > limitPct,
        freeUnits: channel.medium === 'ott' ? rows.reduce((sum, row) => sum + (row.impressionsAvailable ?? 0), 0) : rows.length,
        reachThousands,
      };
      pricing.options.push(option);
    }
  }
  return pricing;
}
