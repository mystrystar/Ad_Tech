import { useCallback, useEffect, useState } from 'react';
import { crore, get, PLANNER, post, tone, words, type Approver } from './api';

interface DashboardData {
  briefs: { id: string; status: string; agency: string | null; client: string | null; sourceFormat: string; startDate: string | null; endDate: string | null; budgetTotal: number | null; planTotal: number | null; openFlags: number; salesforceRecordId: string | null }[];
  statusCounts: Record<string, number>;
  flagSummary: { type: string; label: string; total: number; open: number }[];
  pendingApprovals: { proposalId: string; client: string | null; flagKey: string; message: string; status: string; waitingOn: string | null; secondApproverId: string | null }[];
  approvalsLog: { id: string; proposalId: string; flagType: string; flag: string; plannerDecision: string; secondApprover: string | null; status: string; updatedAt: string }[];
}

export function Dashboard({ viewer, approvers }: { viewer: string; approvers: Approver[] }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => { get<DashboardData>('/dashboard').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(refresh, [refresh]);

  const decide = async (proposalId: string, flagKey: string, decision: string) => {
    setError('');
    try {
      await post(`/proposals/${proposalId}/discount/second`, { flagKey, approverId: viewer, decision });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="sub">Loading…</p>;
  const mine = data.pendingApprovals.filter((a) => a.status === 'pending_second_approver' && a.secondApproverId === viewer);
  const viewerName = approvers.find((a) => a.id === viewer)?.name;

  return (
    <>
      <div className="head">
        <h1>Dashboard</h1>
        <a href="#/new"><button className="primary">New brief</button></a>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="banner warn">All inventory is mock data and UNVERIFIED. Salesforce records are mock records.</p>

      {viewer !== PLANNER && (
        <section className="panel">
          <h2>Waiting on {viewerName}</h2>
          {mine.length === 0 ? <p className="sub">Nothing is waiting on you.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Proposal</th><th>Client</th><th>Discount</th><th>Decision</th></tr></thead>
              <tbody>{mine.map((a) => (
                <tr key={a.flagKey}>
                  <td><a href={`#/p/${a.proposalId}`}>{a.proposalId}</a></td><td>{a.client}</td><td>{a.message}</td>
                  <td><div className="row">
                    <button className="primary" onClick={() => decide(a.proposalId, a.flagKey, 'approved')}>Approve</button>
                    <button className="danger" onClick={() => decide(a.proposalId, a.flagKey, 'refused')}>Refuse</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      <div className="tiles">
        <div className="tile"><b>{data.statusCounts.awaiting_confirmation}</b><span>Awaiting confirmation</span></div>
        <div className="tile"><b>{data.statusCounts.in_review}</b><span>In review</span></div>
        <div className="tile"><b>{data.statusCounts.accepted}</b><span>Accepted</span></div>
        <div className="tile"><b>{data.statusCounts.rejected}</b><span>Rejected</span></div>
        <div className="tile"><b>{data.pendingApprovals.length}</b><span>Pending approvals</span></div>
      </div>

      <section className="panel">
        <h2>Briefs</h2>
        {data.briefs.length === 0 ? <p className="sub">No briefs yet. Start with <a href="#/new">the sample brief</a>.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Proposal</th><th>Agency</th><th>Client</th><th>Format</th><th>Dates</th><th className="num">Budget</th><th className="num">Plan</th><th className="num">Open flags</th><th>Status</th></tr></thead>
            <tbody>{data.briefs.map((b) => (
              <tr key={b.id}>
                <td><a href={`#/p/${b.id}`}>{b.id}</a></td><td>{b.agency ?? '-'}</td><td>{b.client ?? '-'}</td><td>{b.sourceFormat}</td>
                <td>{b.startDate ?? '?'} to {b.endDate ?? '?'}</td><td className="num">{crore(b.budgetTotal)}</td><td className="num">{crore(b.planTotal)}</td>
                <td className="num">{b.openFlags}</td><td><span className={`pill ${tone(b.status)}`}>{words(b.status)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
        <h2>Flags on active briefs</h2>
        <div className="scroll"><table>
          <thead><tr><th>Type</th><th className="num">Total</th><th className="num">Still open</th></tr></thead>
          <tbody>{data.flagSummary.map((f) => <tr key={f.type}><td>{f.label}</td><td className="num">{f.total}</td><td className="num">{f.open}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="panel">
        <h2>Pending approvals</h2>
        {data.pendingApprovals.length === 0 ? <p className="sub">No discount approvals are pending.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Proposal</th><th>Client</th><th>Discount</th><th>Waiting on</th><th>Status</th></tr></thead>
            <tbody>{data.pendingApprovals.map((a) => (
              <tr key={a.proposalId + a.flagKey}>
                <td><a href={`#/p/${a.proposalId}`}>{a.proposalId}</a></td><td>{a.client}</td><td>{a.message}</td><td>{a.waitingOn}</td>
                <td><span className={`pill ${tone(a.status)}`}>{words(a.status)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
        <h2>Approvals log</h2>
        {data.approvalsLog.length === 0 ? <p className="sub">Planner decisions will appear here.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Proposal</th><th>Flag type</th><th>Flag</th><th>Planner decision</th><th>Second approver</th><th>Status</th></tr></thead>
            <tbody>{data.approvalsLog.map((row) => (
              <tr key={row.id}>
                <td><a href={`#/p/${row.proposalId}`}>{row.proposalId}</a></td><td>{words(row.flagType)}</td><td>{row.flag}</td><td>{row.plannerDecision}</td><td>{row.secondApprover ?? '-'}</td>
                <td><span className={`pill ${tone(row.status)}`}>{words(row.status)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
