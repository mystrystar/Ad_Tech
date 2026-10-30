// M6: writes an accepted proposal to a mock Salesforce record. Refuses anything not accepted.
import { randomUUID } from 'node:crypto';
import { store } from '../data';
import type { Proposal, SalesforceRecord } from '../types';

export function writeToSalesforce(proposal: Proposal): SalesforceRecord {
  if (proposal.status !== 'accepted' || !proposal.plan) throw new Error('Only an accepted proposal can be written to Salesforce.');
  const { brief, plan } = proposal;
  const record: SalesforceRecord = {
    id: `MOCK-OPP-${randomUUID().slice(0, 8).toUpperCase()}`,
    opportunityName: `${brief.client} ${brief.startDate} to ${brief.endDate}`,
    agency: brief.agency!, client: brief.client!, amount: plan.budget.total,
    startDate: brief.startDate!, endDate: brief.endDate!, status: 'Proposal Accepted',
    proposalId: proposal.id, createdAt: new Date().toISOString(),
    lineItems: plan.lines.map((line) => ({
      channel: line.channelName, timeBand: line.timeBand, lengthSeconds: line.adLength, unitType: line.unitType,
      units: line.units, rate: line.rate, rateUnit: line.rateUnit, amount: line.amount,
    })),
  };
  store.saveSalesforce([...store.salesforce(), record]);
  return record;
}
