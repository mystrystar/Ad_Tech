import { useCallback, useEffect, useState } from 'react';
import { crore, get, inr, PLANNER, post, rateLabel, tone, words, type Approver, type Flag, type ProposalView } from './api';
import { ConfirmBrief } from './ConfirmBrief';

interface Props { id: string; viewer: string; approvers: Approver[] }
type Run = (path: string, body?: unknown) => Promise<void>;

export function ProposalPage({ id, viewer, approvers }: Props) {
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { get<ProposalView>(`/proposals/${id}`).then(setProposal).catch((e) => setError(e.message)); }, [id]);

  const run: Run = useCallback(async (path, body = {}) => {
    setError('');
    try {
      setProposal(await post<ProposalView>(`/proposals/${id}${path}`, body));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  if (!proposal) return error ? <p className="error" role="alert">{error}</p> : <p className="sub">Loading…</p>;
  if (proposal.status === 'awaiting_confirmation') return <ConfirmBrief proposal={proposal} onChange={setProposal} />;

  const { brief, plan, flags, status } = proposal;
  const editable = status === 'in_review' && viewer === PLANNER;
  const blockers = flags.filter((f) => f.blocking);
  const ofType = (type: Flag['type']) => flags.filter((f) => f.type === type);
  const meterMax = plan ? Math.max(plan.budget.max, plan.budget.total) : 1;

  return (
    <>
      <div className="head">
        <div>
          <h1>{brief.client} proposal</h1>
          <p className="sub">{proposal.id} · {brief.agency} · {brief.startDate} to {brief.endDate} · {brief.audience}, NCCS {brief.nccs.join('')} · {brief.targetMedium}</p>
        </div>
        <span className={`pill ${tone(status)}`}>{words(status)}</span>
      </div>
      {error && <p className="banner bad" role="alert">{error}</p>}
      {ofType('unverified_inventory').map((f) => <p className="banner warn" key={f.key}>{f.message}</p>)}
      {ofType('parser_fallback').map((f) => <p className="banner warn" key={f.key}>{f.message}</p>)}
      {viewer !== PLANNER && status === 'in_review' && <p className="banner warn">You are viewing as an approver. Your decisions are on the dashboard. Only the planner can edit this proposal.</p>}
      {status === 'accepted' && <p className="banner ok">Accepted and written to mock Salesforce as {proposal.salesforceRecordId}.</p>}
      {status === 'rejected' && (
        <div className="banner bad row between">
          <span>Rejected: {proposal.rejectionReason}</span>
          <button onClick={async () => { const next = await post<ProposalView>(`/proposals/${id}/replan`); location.hash = `#/p/${next.id}`; }}>Start again from this brief</button>
        </div>
      )}

      {plan && (
        <section className="panel">
          <div className="row between">
            <h2>Budget</h2>
            <span className={`pill ${tone(plan.budget.state)}`}>{plan.budget.state === 'within' ? 'within range' : `${plan.budget.state} range`}</span>
          </div>
          <div className="meter" role="img" aria-label={`Plan total ${crore(plan.budget.total)} of ${crore(plan.budget.max)} maximum`}>
            <i className={plan.budget.state === 'over' ? 'over' : ''} style={{ width: `${(plan.budget.total / meterMax) * 100}%` }} />
          </div>
          <p className="sub">
            Plan total <b className="mono">{crore(plan.budget.total)}</b> against media budget {crore(plan.budget.target)} (allowed {crore(plan.budget.min)} to {crore(plan.budget.max)}).
            Client budget {crore(brief.budget.total)}{brief.budget.allIn ? ` includes ${brief.budget.taxPct}% GST` : ''}.
          </p>
          {ofType('budget').map((f) => <p className="error" key={f.key}>{f.message}</p>)}
          {plan.notes.map((note) => <p className="error" key={note}>{note}</p>)}
        </section>
      )}

      <RateConflicts proposal={proposal} flags={ofType('rate_conflict')} editable={editable} run={run} />
      <DiscountBreaches proposal={proposal} flags={ofType('discount_breach')} editable={editable} approvers={approvers} run={run} />
      <LengthMismatches flags={ofType('ad_length_mismatch')} editable={editable} run={run} />
      <PlanTable key={proposal.versions.length} proposal={proposal} editable={editable} run={run} />

      {editable && (
        <Decision blockers={blockers} run={run} />
      )}

      {proposal.inventorySummary && (
        <section className="panel">
          <h2>Inventory check</h2>
          <p className="sub">{proposal.inventorySummary.freeCount} free breaks found. {proposal.inventorySummary.blockedCount} blocked by the separation rule ({brief.separationRule.raw ?? 'none'}).</p>
          {proposal.inventorySummary.excludedChannels.map((c) => <p className="sub" key={c.channelId}>{c.name} left out: {c.reason}.</p>)}
        </section>
      )}

      <section className="panel">
        <h2>Version history</h2>
        <div className="scroll"><table>
          <thead><tr><th>Version</th><th>Change</th><th className="num">Lines</th><th className="num">Total</th><th>When</th></tr></thead>
          <tbody>{[...proposal.versions].reverse().map((v) => (
            <tr key={v.version}><td>v{v.version}</td><td>{v.action}</td><td className="num">{v.lineCount}</td><td className="num">{crore(v.total)}</td><td>{new Date(v.at).toLocaleString()}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

function RateConflicts({ proposal, flags, editable, run }: { proposal: ProposalView; flags: Flag[]; editable: boolean; run: Run }) {
  if (!flags.length) return null;
  const openCount = flags.filter((f) => f.status === 'open').length;
  const decideAll = async (decision: string) => {
    for (const f of flags.filter((x) => x.status === 'open')) await run('/rate', { channelId: f.channelId, timeBand: f.timeBand, decision });
  };
  return (
    <section className="panel">
      <div className="row between">
        <div><h2>Rate conflicts ({openCount} open)</h2><p className="sub">The brief says "{proposal.brief.rateInstruction.raw}". Each rate below differs from the current card. You decide.</p></div>
        {editable && openCount > 0 && <button onClick={() => decideAll('rate_card')}>Use rate card for all open</button>}
      </div>
      <div className="scroll"><table>
        <thead><tr><th>Conflict</th><th className="num">Off card</th><th className="num">Limit</th><th>Status</th>{editable && <th>Decision</th>}</tr></thead>
        <tbody>{flags.map((f) => {
          const decision = proposal.rateDecisions[`${f.channelId}|${f.timeBand}`];
          return (
            <tr key={f.key}>
              <td>{f.message}</td>
              <td className="num">{f.discountPct}%</td>
              <td className="num">{f.limitPct}%</td>
              <td><span className={`pill ${tone(f.status)}`}>{decision ? words(decision) : 'open'}</span></td>
              {editable && <td><div className="row">
                <button disabled={decision === 'rate_card'} onClick={() => run('/rate', { channelId: f.channelId, timeBand: f.timeBand, decision: 'rate_card' })}>Rate card</button>
                <button disabled={decision === 'last_year'} onClick={() => run('/rate', { channelId: f.channelId, timeBand: f.timeBand, decision: 'last_year' })}>Last year</button>
              </div></td>}
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

function DiscountBreaches({ proposal, flags, editable, approvers, run }: { proposal: ProposalView; flags: Flag[]; editable: boolean; approvers: Approver[]; run: Run }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  if (!flags.length) return null;
  const nameOf = (id?: string | null) => approvers.find((a) => a.id === id)?.name ?? '-';
  return (
    <section className="panel">
      <div><h2>Discount breaches</h2><p className="sub">Each one needs your approval, then a second approval from a person you pick.</p></div>
      <div className="scroll"><table>
        <thead><tr><th>Breach</th><th>Second approver</th><th>Status</th>{editable && <th>Decision</th>}</tr></thead>
        <tbody>{flags.map((f) => (
          <tr key={f.key}>
            <td>{f.message}</td>
            <td>{nameOf(f.secondApproverId)}</td>
            <td><span className={`pill ${tone(f.status)}`}>{words(f.status)}</span></td>
            {editable && <td>{f.status === 'pending_planner' ? (
              <div className="row">
                <select id={`approver-${f.key}`} aria-label="Second approver" value={picked[f.key] ?? ''} onChange={(e) => setPicked({ ...picked, [f.key]: e.target.value })}>
                  <option value="">Pick second approver</option>
                  {approvers.map((a) => <option key={a.id} value={a.id}>{a.name}, {a.title}</option>)}
                </select>
                <button className="primary" disabled={!picked[f.key]} onClick={() => run('/discount/planner', { flagKey: f.key, decision: 'approved', secondApproverId: picked[f.key] })}>Approve and send</button>
                <button className="danger" onClick={() => run('/discount/planner', { flagKey: f.key, decision: 'refused' })}>Refuse</button>
              </div>
            ) : f.status === 'refused' ? <span className="sub">Change this rate in the plan or pick the rate card above.</span>
              : f.status === 'pending_second_approver' ? <span className="sub">Waiting for {nameOf(f.secondApproverId)}. Switch "Viewing as" to act.</span>
              : <span className="sub">Done</span>}</td>}
          </tr>
        ))}</tbody>
      </table></div>
      {proposal.status === 'in_review' && !editable && <p className="sub">Only the planner can act here.</p>}
    </section>
  );
}

function LengthMismatches({ flags, editable, run }: { flags: Flag[]; editable: boolean; run: Run }) {
  if (!flags.length) return null;
  return (
    <section className="panel">
      <div><h2>Ad length mismatches</h2><p className="sub">Keep the lines and ask the agency for a compliant ad, or remove them from the plan.</p></div>
      <div className="scroll"><table>
        <thead><tr><th>Mismatch</th><th>Status</th>{editable && <th>Decision</th>}</tr></thead>
        <tbody>{flags.map((f) => (
          <tr key={f.key}>
            <td>{f.message}</td>
            <td><span className={`pill ${tone(f.status)}`}>{words(f.status)}</span></td>
            {editable && <td>{f.status === 'removed' ? <span className="sub">Lines removed</span> : (
              <div className="row">
                <button disabled={f.status === 'acknowledged'} onClick={() => run('/length', { medium: f.medium, seconds: f.seconds, decision: 'keep' })}>Keep, agency to supply new ad</button>
                <button className="danger" onClick={() => run('/length', { medium: f.medium, seconds: f.seconds, decision: 'remove' })}>Remove lines</button>
              </div>
            )}</td>}
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function PlanTable({ proposal, editable, run }: { proposal: ProposalView; editable: boolean; run: Run }) {
  const plan = proposal.plan!;
  const options = proposal.pricing?.options ?? [];
  const [edits, setEdits] = useState<Record<string, { units?: number; rate?: number }>>({});
  const [add, setAdd] = useState({ option: '', adLength: '30', units: '' });
  const [rebuildArmed, setRebuildArmed] = useState(false);
  const change = (id: string, key: 'units' | 'rate', value: string) => setEdits({ ...edits, [id]: { ...edits[id], [key]: Number(value) } });
  const dirty = Object.keys(edits).length > 0;

  const addLine = () => {
    const [channelId, timeBand] = add.option.split('|');
    run('/edit', { add: [{ channelId, timeBand, adLength: Number(add.adLength), units: Number(add.units) }] });
  };

  return (
    <section className="panel">
      <div className="row between">
        <h2>Plan</h2>
        {editable && <div className="row">
          {dirty && <button className="primary" onClick={() => run('/edit', { lines: Object.entries(edits).map(([id, e]) => ({ id, ...e })) })}>Save edits</button>}
          {rebuildArmed
            ? <><span className="sub">This replaces manual edits.</span><button className="danger" onClick={() => run('/rebuild')}>Confirm rebuild</button><button onClick={() => setRebuildArmed(false)}>Cancel</button></>
            : <button onClick={() => setRebuildArmed(true)}>Rebuild to fit budget</button>}
        </div>}
      </div>
      <div className="scroll"><table>
        <thead><tr><th>Channel / app</th><th>Genre</th><th>Band</th><th className="num">Length</th><th className="num">Spots / impressions</th><th className="num">Rate</th><th>Rate source</th><th className="num">Amount</th>{editable && <th />}</tr></thead>
        <tbody>{plan.lines.map((line) => (
          <tr key={line.id}>
            <td>{line.channelName}</td><td>{line.genre}</td><td>{line.timeBand}</td><td className="num">{line.adLength}s</td>
            <td className="num">{editable
              ? <input className="small" aria-label={`Quantity for ${line.channelName} ${line.timeBand} ${line.adLength} sec`} type="number" min="1" defaultValue={line.units} onChange={(e) => change(line.id, 'units', e.target.value)} />
              : `${line.units.toLocaleString('en-IN')} ${line.unitType === 'spots' ? 'spots' : 'imp'}`}</td>
            <td className="num">{editable
              ? <input className="small" aria-label={`Rate for ${line.channelName} ${line.timeBand} ${line.adLength} sec`} type="number" step="any" min="0" defaultValue={line.rate} onChange={(e) => change(line.id, 'rate', e.target.value)} />
              : rateLabel(line.rate, line.rateUnit)}</td>
            <td>{words(line.rateSource)}</td>
            <td className="num">{inr(line.amount)}</td>
            {editable && <td><button className="danger" onClick={() => run('/edit', { lines: [{ id: line.id, remove: true }] })}>Remove</button></td>}
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={7}>Total, before GST</td><td className="num">{inr(plan.budget.total)}</td>{editable && <td />}</tr></tfoot>
      </table></div>
      {editable && (
        <div className="row">
          <select id="add-option" aria-label="Channel and time band to add" value={add.option} onChange={(e) => setAdd({ ...add, option: e.target.value })}>
            <option value="">Add a line: choose channel and band</option>
            {options.map((o) => <option key={o.channelId + o.timeBand} value={`${o.channelId}|${o.timeBand}`}>{o.channelName} {o.timeBand} ({rateLabel(o.chosenRate, o.rateUnit)})</option>)}
          </select>
          <input id="add-length" className="small" aria-label="Ad length in seconds" type="number" value={add.adLength} onChange={(e) => setAdd({ ...add, adLength: e.target.value })} />
          <input id="add-units" className="small" aria-label="Spots or impressions" type="number" placeholder="Quantity" value={add.units} onChange={(e) => setAdd({ ...add, units: e.target.value })} />
          <button disabled={!add.option || !add.units} onClick={addLine}>Add line</button>
        </div>
      )}
    </section>
  );
}

function Decision({ blockers, run }: { blockers: Flag[]; run: Run }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <section className="panel">
      <h2>Your decision</h2>
      {blockers.length > 0
        ? <><p className="sub">Resolve these before you can accept:</p><ul className="list">{blockers.map((f) => <li key={f.key}>{f.message}</li>)}</ul></>
        : <p className="sub">Nothing is blocking acceptance. Accepting writes this plan to mock Salesforce.</p>}
      <div className="row">
        <button className="primary" disabled={blockers.length > 0} onClick={() => run('/accept')}>Accept proposal</button>
        {!rejecting && <button className="danger" onClick={() => setRejecting(true)}>Reject</button>}
        {rejecting && <>
          <input id="reject-reason" aria-label="Reason for rejecting" placeholder="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="danger" disabled={!reason.trim()} onClick={() => run('/reject', { reason })}>Confirm reject</button>
          <button onClick={() => setRejecting(false)}>Cancel</button>
        </>}
      </div>
    </section>
  );
}
