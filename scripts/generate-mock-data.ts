// Generates all mock data in data/. Seeded, so reruns give identical files. All names are fictional.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AudienceRow, Channel, InventoryRow, LastYearDeal, RateCardRow, TimeBand } from '../server/types';

let seed = 20261020;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];

const HINDI_BELT = ['Uttar Pradesh', 'Bihar', 'Madhya Pradesh', 'Rajasthan', 'Delhi', 'Haryana', 'Jharkhand', 'Chhattisgarh', 'Uttarakhand', 'Himachal Pradesh'];
const SOUTH = ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana'];
const NATIONAL = [...HINDI_BELT, 'Maharashtra', ...SOUTH];

const knowledgeBase = {
  timeBands: {
    peak: { hours: '19:00-23:00', reachFactor: 1 },
    slow: { hours: '06:00-19:00 and 23:00-01:00', reachFactor: 0.35 },
  },
  terms: {
    around: { meaning: 'Plan may land within 5% either side of the stated budget', tolerancePct: 5 },
    'all in': { meaning: 'Stated budget includes 18% GST, so media spend is the budget divided by 1.18', taxPct: 18 },
    gec: { meaning: 'General Entertainment Channel: serials, reality and family programming' },
    nccs: { meaning: 'New Consumer Classification System. A and B are the higher-affluence households' },
    digital: { meaning: 'Our OTT app' },
    'hindi belt': { meaning: 'The Hindi-speaking states listed in regionGroups' },
    peak: { meaning: 'Prime time, 19:00-23:00' },
    slow: { meaning: 'Non-prime time, 06:00-19:00 and 23:00-01:00' },
  },
  genreAliases: { gec: 'GEC', 'general entertainment': 'GEC', sports: 'Sports', sport: 'Sports', digital: 'OTT', ott: 'OTT', streaming: 'OTT' },
  genreIntensity: { strong: 60, some: 15, default: 25 },
  lengthIntensity: { mostly: 80, few: 20, default: 50 },
  regionGroups: { 'hindi belt': HINDI_BELT },
  states: NATIONAL,
  defaultYearRule: 'A date with no year uses the current year',
};

const channels: Channel[] = [
  { id: 'aangan-tv', name: 'Aangan TV', genre: 'GEC', medium: 'linear', regions: [...HINDI_BELT, 'Maharashtra'] },
  { id: 'kahani-plus', name: 'Kahani Plus', genre: 'GEC', medium: 'linear', regions: [...HINDI_BELT, 'Maharashtra'] },
  { id: 'mogra-marathi', name: 'Mogra Marathi', genre: 'GEC', medium: 'linear', regions: ['Maharashtra'] },
  { id: 'kaveri-tamil', name: 'Kaveri Tamil', genre: 'GEC', medium: 'linear', regions: ['Tamil Nadu', 'Kerala', 'Karnataka'] },
  { id: 'khel-arena', name: 'Khel Arena', genre: 'Sports', medium: 'linear', regions: NATIONAL },
  { id: 'stadium-9', name: 'Stadium 9', genre: 'Sports', medium: 'linear', regions: [...HINDI_BELT, 'Maharashtra'] },
  { id: 'streamnest', name: 'StreamNest', genre: 'OTT', medium: 'ott', regions: NATIONAL },
];

const VALID = { validFrom: '2026-04-01', validTo: '2027-03-31' };
const linearRates: Record<string, Record<TimeBand, number>> = {
  'aangan-tv': { peak: 42000, slow: 12000 },
  'kahani-plus': { peak: 36000, slow: 10000 },
  'mogra-marathi': { peak: 18000, slow: 6000 },
  'kaveri-tamil': { peak: 20000, slow: 6500 },
  'khel-arena': { peak: 30000, slow: 9000 },
  'stadium-9': { peak: 22000, slow: 7000 },
};
const rateCard: RateCardRow[] = [];
for (const [channelId, bands] of Object.entries(linearRates)) {
  for (const timeBand of ['peak', 'slow'] as TimeBand[]) {
    for (const adLength of [10, 20, 30, 60]) rateCard.push({ channelId, timeBand, adLength, ratePer10Sec: bands[timeBand], ...VALID });
  }
}
rateCard.push(
  { channelId: 'streamnest', timeBand: 'peak', adLength: null, ratePerImpression: 0.6, ...VALID },
  { channelId: 'streamnest', timeBand: 'slow', adLength: null, ratePerImpression: 0.4, ...VALID },
);

const allowedLengths = [
  { medium: 'linear', minSeconds: 10, maxSeconds: 60 },
  { medium: 'ott', minSeconds: 40, maxSeconds: 90 },
];

const discountLimits = [
  { scope: 'genre', key: 'GEC', maxDiscountPct: 15 },
  { scope: 'genre', key: 'Sports', maxDiscountPct: 10 },
  { scope: 'genre', key: 'OTT', maxDiscountPct: 20 },
  { scope: 'channel', key: 'mogra-marathi', maxDiscountPct: 20 },
];

// Stadium 9 has no deal last year. Some rates match the card, some sit within the limit, some breach it.
const deal = (channelId: string, timeBand: TimeBand, ratePaid: number): LastYearDeal => ({
  agency: 'Bluekite Media', client: 'Fizzwell Beverages', channelId, timeBand, ratePaid, startDate: '2025-10-18', endDate: '2025-11-10',
});
const lastYearDeals: LastYearDeal[] = [
  deal('aangan-tv', 'peak', 36000), deal('aangan-tv', 'slow', 12000),
  deal('kahani-plus', 'peak', 29000), deal('kahani-plus', 'slow', 9000),
  deal('mogra-marathi', 'peak', 15000), deal('mogra-marathi', 'slow', 6000),
  deal('khel-arena', 'peak', 25000), deal('khel-arena', 'slow', 8500),
  deal('streamnest', 'peak', 0.45), deal('streamnest', 'slow', 0.36),
];

const audienceFit: Record<string, number> = { 'aangan-tv': 1, 'kahani-plus': 0.85, 'mogra-marathi': 0.5, 'kaveri-tamil': 0.7, 'khel-arena': 0.35, 'stadium-9': 0.25, streamnest: 0.6 };
const audienceData: AudienceRow[] = [];
for (const channel of channels) {
  for (const audience of ['Women 25-44', 'Men 25-44', 'Adults 18-54']) {
    for (const nccs of ['A', 'B', 'C']) {
      for (const region of channel.regions) {
        const base = 80 + rand() * 120;
        audienceData.push({ channelId: channel.id, audience, nccs, region, reachThousands: Math.round(base * audienceFit[channel.id]) });
      }
    }
  }
}

const OTHER_ADVERTISERS = [
  { advertiser: 'Velora Skincare', category: 'Personal Care' },
  { advertiser: 'Trident Motors', category: 'Auto' },
  { advertiser: 'Nimbus Telecom', category: 'Telecom' },
  { advertiser: 'Sahyog Bank', category: 'Banking' },
  { advertiser: 'Haat Bazaar Online', category: 'Retail' },
  { advertiser: 'Ghar Fresh Atta', category: 'Packaged Food' },
];
const RIVAL_BEVERAGES = [
  { advertiser: 'Coolbreeze Colas', category: 'Beverage' },
  { advertiser: 'Tazaa Tea Co', category: 'Beverage' },
];

const dates: string[] = [];
for (let day = new Date(Date.UTC(2026, 9, 1)); day <= new Date(Date.UTC(2026, 10, 30)); day.setUTCDate(day.getUTCDate() + 1)) {
  dates.push(day.toISOString().slice(0, 10));
}

const inventory: InventoryRow[] = [];
for (const channel of channels) {
  const breaksPerBand = channel.medium === 'ott' ? 3 : 5;
  for (const date of dates) {
    for (const timeBand of ['peak', 'slow'] as TimeBand[]) {
      for (let b = 1; b <= breaksPerBand; b++) {
        const booked = rand() < 0.2 ? [pick(RIVAL_BEVERAGES)] : [];
        if (rand() < 0.6) booked.push(pick(OTHER_ADVERTISERS));
        const row: InventoryRow = { id: `${channel.id}-${date}-${timeBand}-${b}`, channelId: channel.id, date, timeBand, break: `B${b}`, booked, verified: 'no' };
        if (channel.medium === 'ott') row.impressionsAvailable = 1000 * Math.round(120 + rand() * 180);
        else row.secondsAvailable = pick([0, 20, 30, 60, 60, 90, 120, 120, 180]);
        inventory.push(row);
      }
    }
  }
}

const approvers = [
  { id: 'meera-joshi', name: 'Meera Joshi', title: 'Sales Head' },
  { id: 'karan-sethi', name: 'Karan Sethi', title: 'Revenue Director' },
  { id: 'nisha-rao', name: 'Nisha Rao', title: 'Pricing Lead' },
];

const files: Record<string, unknown> = {
  'knowledge-base': knowledgeBase, channels, 'rate-card': rateCard, 'allowed-lengths': allowedLengths,
  'discount-limits': discountLimits, 'last-year-deals': lastYearDeals, 'audience-data': audienceData, inventory, approvers,
};
mkdirSync('data', { recursive: true });
for (const [name, value] of Object.entries(files)) writeFileSync(`data/${name}.json`, JSON.stringify(value, null, 1));
console.log(`Mock data written: ${inventory.length} inventory rows, ${audienceData.length} audience rows, ${rateCard.length} rate card rows`);
