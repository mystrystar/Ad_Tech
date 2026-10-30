// Dashboard: read-only view across all modules.
import { mock, store } from './data';

export function dashboard() {
  const proposals = store.proposals();
  const active = proposals.filter((p) => p.status === 'in_review' || p.status === 'awaiting_confirmation');
  const allFlags = active.flatMap((p) => p.flags);
  const count = (type: string) => allFlags.filter((f) => f.type === type).length;
  const open = (type: string) => allFlags.filter((f) => f.type === type && f.blocking).length;
  const approverName = (id?: string | null) => mock.approvers.find((a) => a.id === id)?.name ?? null;

  return {
    briefs: proposals.map((p) => ({
      id: p.id, status: p.status, updatedAt: p.updatedAt, agency: p.brief.agency, client: p.brief.client,
      sourceFormat: p.brief.sourceFormat, startDate: p.brief.startDate, endDate: p.brief.endDate,
      budgetTotal: p.brief.budget.total, planTotal: p.plan?.budget.total ?? null,
      openFlags: p.flags.filter((f) => f.blocking).length, salesforceRecordId: p.salesforceRecordId,
    })).reverse(),
    statusCounts: {
      awaiting_confirmation: proposals.filter((p) => p.status === 'awaiting_confirmation').length,
      in_review: proposals.filter((p) => p.status === 'in_review').length,
      accepted: proposals.filter((p) => p.status === 'accepted').length,
      rejected: proposals.filter((p) => p.status === 'rejected').length,
    },
    flagSummary: [
      { type: 'unverified_inventory', label: 'Unverified inventory', total: count('unverified_inventory'), open: 0 },
      { type: 'rate_conflict', label: 'Rate conflicts', total: count('rate_conflict'), open: open('rate_conflict') },
      { type: 'discount_breach', label: 'Discount breaches', total: count('discount_breach'), open: open('discount_breach') },
      { type: 'ad_length_mismatch', label: 'Ad length mismatches', total: count('ad_length_mismatch'), open: open('ad_length_mismatch') },
    ],
    pendingApprovals: active.flatMap((p) => p.flags
      .filter((f) => f.type === 'discount_breach' && (f.status === 'pending_planner' || f.status === 'pending_second_approver' || f.status === 'refused'))
      .map((f) => ({
        proposalId: p.id, client: p.brief.client, flagKey: f.key, message: f.message, status: f.status,
        waitingOn: f.status === 'pending_second_approver' ? approverName(f.secondApproverId) : 'Planner',
        secondApproverId: f.secondApproverId ?? null,
      }))),
    approvalsLog: store.approvals().slice().reverse(),
  };
}
