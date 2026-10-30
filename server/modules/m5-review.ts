// M5: human gate. Holds the proposal, its flags and every planner decision. Nothing reaches M6 without acceptance.
import { randomUUID } from 'node:crypto';
import { mock, store } from '../data';
import type { ApprovalLogEntry, BriefRecord, Flag, Medium, PlanLine, Proposal, TimeBand } from '../types';
import { budgetFields, deriveTargetMedium, missingFields } from './m1-intake';
import { checkInventory } from './m2-inventory';
import { discountPct, limitFor, priceInventory, rateKey } from './m3-pricing';
import { assignSlots, budgetStatus, buildPlan, checkAdLengths, lengthKey, lineAmount, newLine } from './m4-plan';
import { expandRegions } from './m0-knowledge';
import { writeToSalesforce } from './m6-salesforce';

export class ReviewError extends Error {}

const now = () => new Date().toISOString();

export function createProposal(brief: BriefRecord): Proposal {
  const proposal: Proposal = {
    id: `P-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: now(), updatedAt: now(), status: 'awaiting_confirmation',
    brief, rateDecisions: {}, lengthDecisions: {}, discountApprovals: {}, plan: null, inventorySummary: null,
    flags: [], versions: [], rejectionReason: null, salesforceRecordId: null,
  };
  store.saveProposal(proposal);
  return proposal;
}

function requireProposal(id: string): Proposal {
  const proposal = store.proposal(id);
  if (!proposal) throw new ReviewError('Proposal not found.');
  return proposal;
}
function requireInReview(id: string): Proposal {
  const proposal = requireProposal(id);
  if (proposal.status !== 'in_review') throw new ReviewError(`This proposal is ${proposal.status.replace(/_/g, ' ')} and can no longer be changed.`);
  return proposal;
}

const money = (value: number, unit: string) => (unit === 'per_impression' ? `₹${value} per impression` : `₹${value.toLocaleString('en-IN')} per 10 sec`);

// Recalculates every flag from the current plan and decisions, so edits can never leave a stale flag behind.
function computeFlags(proposal: Proposal): Flag[] {
  const { brief, plan } = proposal;
  if (!plan) return [];
  const flags: Flag[] = [{
    key: 'unverified', type: 'unverified_inventory', status: 'info', blocking: false,
    message: 'All inventory is mock data and UNVERIFIED. Confirm availability before committing.',
  }];
  if (brief.parsedBy === 'fallback_rules') {
    flags.push({ key: 'parser', type: 'parser_fallback', status: 'info', blocking: false, message: brief.parserNote ?? 'Parsed with basic text rules.' });
  }

  const pricing = priceInventory(brief, checkInventory(brief), proposal.rateDecisions);
  const planned = new Set(plan.lines.map((line) => rateKey(line.channelId, line.timeBand)));
  for (const option of pricing.options) {
    const key = rateKey(option.channelId, option.timeBand);
    if (!option.hasConflict || !planned.has(key)) continue;
    const decision = proposal.rateDecisions[key];
    flags.push({
      key: `rate|${key}`, type: 'rate_conflict', status: decision ? 'decided' : 'open', blocking: !decision,
      channelId: option.channelId, timeBand: option.timeBand, cardRate: option.cardRate, lastYearRate: option.lastYearRate!,
      discountPct: option.discountIfLastYearPct!, limitPct: option.limitPct,
      message: `${option.channelName} ${option.timeBand}: rate card ${money(option.cardRate, option.rateUnit)}, last year ${money(option.lastYearRate!, option.rateUnit)}.${option.breachIfLastYear ? ` Last year's rate is ${option.discountIfLastYearPct}% off, over the ${option.limitPct}% limit.` : ''}`,
    });
  }

  const seen = new Set<string>();
  for (const line of plan.lines) {
    const discount = discountPct(line.cardRate, line.rate);
    const limit = limitFor(line.channelId, line.genre);
    const key = `discount|${line.channelId}|${line.timeBand}|${line.rate}`;
    if (discount <= limit || seen.has(key)) continue;
    seen.add(key);
    const approval = proposal.discountApprovals[key];
    let status: Flag['status'] = 'pending_planner';
    if (approval?.plannerDecision === 'refused' || approval?.secondDecision === 'refused') status = 'refused';
    else if (approval?.secondDecision === 'approved') status = 'approved';
    else if (approval?.plannerDecision === 'approved') status = 'pending_second_approver';
    flags.push({
      key, type: 'discount_breach', status, blocking: status !== 'approved',
      channelId: line.channelId, timeBand: line.timeBand, rate: line.rate, cardRate: line.cardRate, discountPct: discount, limitPct: limit,
      secondApproverId: approval?.secondApproverId ?? null,
      message: `${line.channelName} ${line.timeBand}: ${discount}% discount is over the ${limit}% limit.`,
    });
  }

  for (const check of plan.lengthChecks) {
    if (check.ok) continue;
    const decision = proposal.lengthDecisions[lengthKey(check.medium, check.seconds)];
    flags.push({
      key: `length|${check.medium}|${check.seconds}`, type: 'ad_length_mismatch',
      status: decision === 'remove' ? 'removed' : decision === 'keep' ? 'acknowledged' : 'open', blocking: !decision,
      medium: check.medium, seconds: check.seconds,
      message: `${check.seconds} sec is outside the ${check.medium === 'ott' ? 'OTT' : 'linear'} limit of ${check.minSeconds} to ${check.maxSeconds} sec.`,
    });
  }

  if (plan.budget.state !== 'within') {
    flags.push({
      key: 'budget', type: 'budget', status: 'info', blocking: false,
      message: `Plan total is ${plan.budget.state} the allowed range by ₹${Math.abs(plan.budget.total - (plan.budget.state === 'over' ? plan.budget.max : plan.budget.min)).toLocaleString('en-IN')}.`,
    });
  }
  return flags;
}

// Discount approvals tied to a rate that is no longer in the plan stop counting.
function syncLog(proposal: Proposal) {
  const active = new Set(proposal.flags.map((f) => f.key));
  const rows = store.approvals().map((row) =>
    row.proposalId === proposal.id && row.flagType === 'discount_breach' && !active.has(row.flagKey) && row.status !== 'superseded'
      ? { ...row, status: 'superseded', updatedAt: now() } : row);
  store.saveApprovals(rows);
}

function logDecision(proposal: Proposal, flagKey: string, flagType: ApprovalLogEntry['flagType'], flag: string, plannerDecision: string, secondApprover: string | null, status: string) {
  const rows = store.approvals();
  const entry: ApprovalLogEntry = { id: randomUUID(), proposalId: proposal.id, flagKey, flagType, flag, plannerDecision, secondApprover, status, updatedAt: now() };
  const index = rows.findIndex((row) => row.proposalId === proposal.id && row.flagKey === flagKey);
  if (index >= 0) rows[index] = { ...entry, id: rows[index].id };
  else rows.push(entry);
  store.saveApprovals(rows);
}

function commit(proposal: Proposal, action: string): Proposal {
  proposal.flags = computeFlags(proposal);
  if (proposal.plan) {
    proposal.versions.push({ version: proposal.versions.length + 1, at: now(), action, total: proposal.plan.budget.total, lineCount: proposal.plan.lines.length });
  }
  store.saveProposal(proposal);
  syncLog(proposal);
  return proposal;
}

function runPlanning(proposal: Proposal) {
  const inventory = checkInventory(proposal.brief);
  const pricing = priceInventory(proposal.brief, inventory, proposal.rateDecisions);
  proposal.plan = buildPlan(proposal.brief, inventory, pricing, proposal.lengthDecisions);
  proposal.inventorySummary = { freeCount: inventory.free.length, blockedCount: inventory.blocked.length, excludedChannels: inventory.excludedChannels };
}

export interface BriefEdits {
  agency: string; client: string; category: string; budgetTotal: number; startDate: string; endDate: string;
  audience: string; nccs: string[]; regions: string; blockedCategory: string;
  genres: { genre: string; sharePct: number }[]; adLengths: { seconds: number; sharePct: number }[];
}

// Delighter: the planner checks the parsed brief, fixes anything, and only then planning starts.
export function confirmBrief(id: string, edits: BriefEdits): Proposal {
  const proposal = requireProposal(id);
  if (proposal.status !== 'awaiting_confirmation') throw new ReviewError('This brief is already confirmed.');
  const brief = proposal.brief;
  const { tolerancePct, taxPct, allIn, raw } = brief.budget;
  const genres = edits.genres.filter((g) => g.sharePct > 0).map((g) => {
    const existing = brief.genres.find((b) => b.genre === g.genre);
    const medium: Medium = g.genre === 'OTT' ? 'ott' : 'linear';
    return { raw: existing?.raw ?? g.genre, genre: g.genre, medium, sharePct: g.sharePct };
  });
  const updated: BriefRecord = {
    ...brief,
    agency: edits.agency?.trim() || null, client: edits.client?.trim() || null, category: edits.category?.trim() || null,
    budget: budgetFields(raw, edits.budgetTotal > 0 ? edits.budgetTotal : null, allIn, tolerancePct, taxPct),
    startDate: edits.startDate || null, endDate: edits.endDate || null, audience: edits.audience?.trim() || null,
    nccs: edits.nccs, regions: { raw: [edits.regions], states: expandRegions(edits.regions).states },
    genres, targetMedium: deriveTargetMedium(genres),
    adLengths: edits.adLengths.filter((l) => l.seconds > 0 && l.sharePct > 0).map((l) => ({ raw: `${l.seconds} sec`, seconds: l.seconds, sharePct: l.sharePct })),
    separationRule: { ...brief.separationRule, blockedCategory: edits.blockedCategory?.trim() || null },
  };
  updated.missingFields = missingFields(updated);
  if (updated.missingFields.length) throw new ReviewError(`Fill in: ${updated.missingFields.join(', ')}.`);
  if (updated.startDate! > updated.endDate!) throw new ReviewError('The start date must be before the end date.');

  proposal.brief = updated;
  proposal.status = 'in_review';
  runPlanning(proposal);
  return commit(proposal, 'Plan built from confirmed brief');
}

export function decideRate(id: string, channelId: string, timeBand: TimeBand, decision: 'rate_card' | 'last_year'): Proposal {
  const proposal = requireInReview(id);
  const key = rateKey(channelId, timeBand);
  const option = priceInventory(proposal.brief, checkInventory(proposal.brief), {}).options.find((o) => o.channelId === channelId && o.timeBand === timeBand);
  if (!option?.hasConflict) throw new ReviewError('There is no rate conflict to decide here.');
  proposal.rateDecisions[key] = decision;
  const rate = decision === 'last_year' ? option.lastYearRate! : option.cardRate;
  for (const line of proposal.plan!.lines) {
    if (line.channelId === channelId && line.timeBand === timeBand) {
      line.rate = rate;
      line.rateSource = decision;
      line.amount = lineAmount(line);
    }
  }
  refreshPlanChecks(proposal);
  logDecision(proposal, `rate|${key}`, 'rate_conflict', `${option.channelName} ${timeBand}`, decision === 'last_year' ? "Use last year's rate" : 'Use rate card', null, 'decided');
  return commit(proposal, `Rate decision: ${option.channelName} ${timeBand}`);
}

function refreshPlanChecks(proposal: Proposal) {
  const plan = proposal.plan!;
  plan.budget = budgetStatus(proposal.brief, plan.lines);
  plan.lengthChecks = checkAdLengths(proposal.brief, plan.lines);
}

export function plannerDiscountDecision(id: string, flagKey: string, decision: 'approved' | 'refused', secondApproverId: string | null): Proposal {
  const proposal = requireInReview(id);
  const flag = proposal.flags.find((f) => f.key === flagKey && f.type === 'discount_breach');
  if (!flag) throw new ReviewError('This discount flag no longer applies.');
  const approver = mock.approvers.find((a) => a.id === secondApproverId);
  if (decision === 'approved' && !approver) throw new ReviewError('Pick a second approver.');
  proposal.discountApprovals[flagKey] = { plannerDecision: decision, secondApproverId: approver?.id ?? null, secondDecision: null };
  logDecision(proposal, flagKey, 'discount_breach', flag.message, decision, approver?.name ?? null, decision === 'approved' ? 'pending_second_approver' : 'refused');
  return commit(proposal, 'Planner discount decision');
}

export function secondApproverDecision(id: string, flagKey: string, approverId: string, decision: 'approved' | 'refused'): Proposal {
  const proposal = requireInReview(id);
  const flag = proposal.flags.find((f) => f.key === flagKey && f.type === 'discount_breach');
  const approval = proposal.discountApprovals[flagKey];
  if (!flag || !approval || flag.status !== 'pending_second_approver') throw new ReviewError('This approval is not waiting on a second approver.');
  if (approval.secondApproverId !== approverId) throw new ReviewError('Only the approver the planner picked can decide this.');
  approval.secondDecision = decision;
  const approver = mock.approvers.find((a) => a.id === approverId)!;
  logDecision(proposal, flagKey, 'discount_breach', flag.message, 'approved', approver.name, decision);
  return commit(proposal, `Second approver ${decision}`);
}

export function decideLength(id: string, medium: Medium, seconds: number, decision: 'keep' | 'remove'): Proposal {
  const proposal = requireInReview(id);
  const plan = proposal.plan!;
  const key = lengthKey(medium, seconds);
  proposal.lengthDecisions[key] = decision;
  if (decision === 'remove') plan.lines = plan.lines.filter((line) => !(line.medium === medium && line.adLength === seconds));
  refreshPlanChecks(proposal);
  logDecision(proposal, `length|${medium}|${seconds}`, 'ad_length_mismatch', `${medium} ${seconds} sec`, decision === 'remove' ? 'Removed lines' : 'Kept, agency to supply a compliant ad', null, 'decided');
  return commit(proposal, `Ad length decision: ${medium} ${seconds} sec`);
}

export interface PlanEdits {
  lines?: { id: string; units?: number; rate?: number; remove?: boolean }[];
  add?: { channelId: string; timeBand: TimeBand; adLength: number; units: number }[];
}

export function editPlan(id: string, edits: PlanEdits): Proposal {
  const proposal = requireInReview(id);
  const plan = proposal.plan!;
  const lines: PlanLine[] = structuredClone(plan.lines);
  const inventory = checkInventory(proposal.brief);
  const pricing = priceInventory(proposal.brief, inventory, proposal.rateDecisions);

  for (const edit of edits.lines ?? []) {
    const index = lines.findIndex((line) => line.id === edit.id);
    if (index < 0) throw new ReviewError('A plan line was not found. Reload the proposal and try again.');
    if (edit.remove) {
      lines.splice(index, 1);
      continue;
    }
    const line = lines[index];
    if (edit.units !== undefined) {
      if (!Number.isInteger(edit.units) || edit.units <= 0) throw new ReviewError('Spots and impressions must be whole numbers above zero.');
      line.units = edit.units;
    }
    if (edit.rate !== undefined && edit.rate !== line.rate) {
      if (!(edit.rate > 0)) throw new ReviewError('A rate must be above zero.');
      line.rate = edit.rate;
      line.rateSource = 'manual';
      proposal.rateDecisions[rateKey(line.channelId, line.timeBand)] = 'manual';
    }
    line.amount = lineAmount(line);
  }
  for (const add of edits.add ?? []) {
    const option = pricing.options.find((o) => o.channelId === add.channelId && o.timeBand === add.timeBand);
    if (!option) throw new ReviewError('That channel and time band have no free inventory for this brief.');
    if (!Number.isInteger(add.units) || add.units <= 0 || !(add.adLength > 0)) throw new ReviewError('Enter a valid ad length and quantity.');
    lines.push(newLine(option, add.adLength, add.units));
  }

  const shortfall = assignSlots(lines, inventory);
  if (shortfall) throw new ReviewError(shortfall);
  plan.lines = lines;
  refreshPlanChecks(proposal);
  return commit(proposal, 'Planner edited the plan');
}

export function rebuild(id: string): Proposal {
  const proposal = requireInReview(id);
  // A rebuild drops manual rates, so any conflict settled by one reopens for a fresh decision.
  for (const [key, choice] of Object.entries(proposal.rateDecisions)) if (choice === 'manual') delete proposal.rateDecisions[key];
  runPlanning(proposal);
  return commit(proposal, 'Plan rebuilt using current rate decisions');
}

export function acceptProposal(id: string): Proposal {
  const proposal = requireInReview(id);
  const blockers = proposal.flags.filter((f) => f.blocking);
  if (blockers.length) throw new ReviewError(`Resolve ${blockers.length} open flag(s) first.`);
  if (!proposal.plan?.lines.length) throw new ReviewError('The plan has no lines to accept.');
  proposal.status = 'accepted';
  proposal.salesforceRecordId = writeToSalesforce(proposal).id;
  store.saveProposal(proposal);
  return proposal;
}

export function rejectProposal(id: string, reason: string): Proposal {
  const proposal = requireInReview(id);
  if (!reason?.trim()) throw new ReviewError('Give a reason for rejecting.');
  proposal.status = 'rejected';
  proposal.rejectionReason = reason.trim();
  store.saveProposal(proposal);
  return proposal;
}

// Lets the planner start again from the same brief after a rejection.
export function replanFromRejected(id: string): Proposal {
  const old = requireProposal(id);
  if (old.status !== 'rejected') throw new ReviewError('Only a rejected proposal can be replanned.');
  return createProposal(old.brief);
}

export function pricingFor(proposal: Proposal) {
  if (proposal.status === 'awaiting_confirmation') return null;
  return priceInventory(proposal.brief, checkInventory(proposal.brief), proposal.rateDecisions);
}
