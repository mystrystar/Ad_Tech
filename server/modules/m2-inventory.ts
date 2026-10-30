// M2: BriefRecord -> InventoryRecord. Same steps for linear and OTT. Everything stays unverified.
import { mock } from '../data';
import type { BriefRecord, EligibleChannel, InventoryRecord } from '../types';

const normalize = (category: string) => category.toLowerCase().replace(/s$/, '');

export function checkInventory(brief: BriefRecord): InventoryRecord {
  const eligibleChannels: EligibleChannel[] = [];
  const excludedChannels: InventoryRecord['excludedChannels'] = [];
  const genres = new Set(brief.genres.map((g) => g.genre));

  for (const channel of mock.channels) {
    if (!genres.has(channel.genre)) continue;
    const overlap = channel.regions.filter((region) => brief.regions.states.includes(region));
    if (!overlap.length) {
      excludedChannels.push({ channelId: channel.id, name: channel.name, reason: 'Does not cover the target regions' });
      continue;
    }
    const audienceRows = mock.audienceData.filter((row) =>
      row.channelId === channel.id && row.audience === brief.audience && brief.nccs.includes(row.nccs) && overlap.includes(row.region));
    if (!audienceRows.length) {
      excludedChannels.push({ channelId: channel.id, name: channel.name, reason: 'No audience data for this audience and NCCS' });
      continue;
    }
    eligibleChannels.push({ channel, reachThousands: audienceRows.reduce((sum, row) => sum + row.reachThousands, 0) });
  }

  const eligibleIds = new Set(eligibleChannels.map((e) => e.channel.id));
  const minLength = Math.min(...brief.adLengths.map((l) => l.seconds));
  const blockedCategory = brief.separationRule.blockedCategory && normalize(brief.separationRule.blockedCategory);
  const result: InventoryRecord = { free: [], blocked: [], eligibleChannels, excludedChannels, verified: 'no' };

  for (const row of mock.inventory) {
    if (!eligibleIds.has(row.channelId) || row.date < brief.startDate! || row.date > brief.endDate!) continue;
    const hasRoom = row.impressionsAvailable !== undefined ? row.impressionsAvailable > 0 : (row.secondsAvailable ?? 0) >= minLength;
    if (!hasRoom) continue;
    const rival = blockedCategory ? row.booked.find((b) => normalize(b.category) === blockedCategory) : undefined;
    if (rival) result.blocked.push({ rowId: row.id, channelId: row.channelId, reason: `${rival.advertiser} (${rival.category}) is already in this break` });
    else result.free.push(row);
  }
  return result;
}
