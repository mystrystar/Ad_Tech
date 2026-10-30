// Loads mock data once and handles the JSON files the app writes to.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AllowedLength, ApprovalLogEntry, Approver, AudienceRow, Channel, DiscountLimit,
  InventoryRow, LastYearDeal, Proposal, RateCardRow, SalesforceRecord,
} from './types';

const DATA_DIR = join(process.cwd(), 'data');
const RUNTIME_DIR = join(DATA_DIR, 'runtime');
const load = <T,>(name: string): T => JSON.parse(readFileSync(join(DATA_DIR, `${name}.json`), 'utf8'));

export const mock = {
  knowledgeBase: load<KnowledgeBase>('knowledge-base'),
  channels: load<Channel[]>('channels'),
  inventory: load<InventoryRow[]>('inventory'),
  rateCard: load<RateCardRow[]>('rate-card'),
  allowedLengths: load<AllowedLength[]>('allowed-lengths'),
  discountLimits: load<DiscountLimit[]>('discount-limits'),
  lastYearDeals: load<LastYearDeal[]>('last-year-deals'),
  audienceData: load<AudienceRow[]>('audience-data'),
  approvers: load<Approver[]>('approvers'),
};

export interface KnowledgeBase {
  timeBands: Record<'peak' | 'slow', { hours: string; reachFactor: number }>;
  terms: Record<string, { meaning: string; tolerancePct?: number; taxPct?: number }>;
  genreAliases: Record<string, string>;
  genreIntensity: Record<string, number>;
  lengthIntensity: Record<string, number>;
  regionGroups: Record<string, string[]>;
  states: string[];
  defaultYearRule: string;
}

function readRuntime<T>(name: string): T[] {
  const path = join(RUNTIME_DIR, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}
function writeRuntime(name: string, rows: unknown[]) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(join(RUNTIME_DIR, `${name}.json`), JSON.stringify(rows, null, 1));
}

export const store = {
  proposals: () => readRuntime<Proposal>('proposals'),
  proposal: (id: string) => readRuntime<Proposal>('proposals').find((p) => p.id === id),
  saveProposal(proposal: Proposal) {
    const rows = readRuntime<Proposal>('proposals');
    const index = rows.findIndex((p) => p.id === proposal.id);
    proposal.updatedAt = new Date().toISOString();
    if (index >= 0) rows[index] = proposal;
    else rows.push(proposal);
    writeRuntime('proposals', rows);
  },
  approvals: () => readRuntime<ApprovalLogEntry>('approvals-log'),
  saveApprovals: (rows: ApprovalLogEntry[]) => writeRuntime('approvals-log', rows),
  salesforce: () => readRuntime<SalesforceRecord>('salesforce-records'),
  saveSalesforce: (rows: SalesforceRecord[]) => writeRuntime('salesforce-records', rows),
};
