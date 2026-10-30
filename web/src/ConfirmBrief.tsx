import { useState } from 'react';
import { crore, post, type ProposalView } from './api';

// Delighter: the planner checks what was parsed and fixes it before planning starts.
export function ConfirmBrief({ proposal, onChange }: { proposal: ProposalView; onChange: (p: ProposalView) => void }) {
  const { brief } = proposal;
  const [form, setForm] = useState({
    agency: brief.agency ?? '', client: brief.client ?? '', category: brief.category ?? '',
    budgetCr: brief.budget.total ? String(brief.budget.total / 10000000) : '',
    startDate: brief.startDate ?? '', endDate: brief.endDate ?? '', audience: brief.audience ?? '',
    nccs: brief.nccs.join(', '), regions: brief.regions.raw.join(' + '), blockedCategory: brief.separationRule.blockedCategory ?? '',
  });
  const [genres, setGenres] = useState(brief.genres.map((g) => ({ genre: g.genre, sharePct: g.sharePct })));
  const [lengths, setLengths] = useState(brief.adLengths.map((l) => ({ seconds: l.seconds, sharePct: l.sharePct })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const isMissing = (name: string) => brief.missingFields.includes(name);

  const field = (label: string, key: keyof typeof form, missing: string, type = 'text') => (
    <label className={`field ${isMissing(missing) ? 'missing' : ''}`} htmlFor={key}>
      {label}{isMissing(missing) && ' (missing from brief)'}
      <input id={key} type={type} value={form[key]} onChange={set(key)} />
    </label>
  );

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      onChange(await post<ProposalView>(`/proposals/${proposal.id}/confirm`, {
        agency: form.agency, client: form.client, category: form.category,
        budgetTotal: Math.round(Number(form.budgetCr) * 10000000),
        startDate: form.startDate, endDate: form.endDate, audience: form.audience,
        nccs: form.nccs.toUpperCase().match(/[A-E]/g) ?? [], regions: form.regions, blockedCategory: form.blockedCategory,
        genres, adLengths: lengths,
      }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <div><h1>Confirm the brief</h1><p className="sub">{proposal.id}, from {brief.sourceFormat}. Planning starts only after you confirm.</p></div>
        <span className={`pill ${brief.parsedBy === 'agent' ? 'accent' : 'warn'}`}>{brief.parsedBy === 'agent' ? 'Read by AI agent' : 'Read by basic rules'}</span>
      </div>
      {brief.parserNote && <p className="banner warn">{brief.parserNote}</p>}
      {brief.missingFields.length > 0 && <p className="banner bad">Missing from the brief: {brief.missingFields.join(', ')}. Fill these in to continue.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="panel">
        <h2>Parsed fields</h2>
        <div className="form">
          {field('Agency', 'agency', 'agency')}
          {field('Client', 'client', 'client')}
          {field('Category', 'category', 'category')}
          {field('Budget, all in (₹ crore)', 'budgetCr', 'budget', 'number')}
          {field('Start date', 'startDate', 'start date', 'date')}
          {field('End date', 'endDate', 'end date', 'date')}
          {field('Audience', 'audience', 'audience')}
          {field('NCCS', 'nccs', 'NCCS')}
          {field('Regions', 'regions', 'regions')}
          {field('Blocked category in same break', 'blockedCategory', 'none')}
        </div>
        <p className="sub">
          Media budget after the knowledge base's rules: {crore(brief.budget.mediaBudget)} (range {crore(brief.budget.min)} to {crore(brief.budget.max)}).
          Target medium: {brief.targetMedium ?? '-'}. Rate instruction: {brief.rateInstruction.raw ?? 'none stated'}.
          Regions cover {brief.regions.states.length} states.
        </p>
      </section>

      <section className="panel">
        <h2>Budget and ad length mix</h2>
        <div className="row">
          {genres.map((g, i) => (
            <label className="field" key={g.genre} htmlFor={`genre-${g.genre}`}>{g.genre} %
              <input id={`genre-${g.genre}`} className="small" type="number" value={g.sharePct}
                onChange={(e) => setGenres(genres.map((x, n) => (n === i ? { ...x, sharePct: Number(e.target.value) } : x)))} />
            </label>
          ))}
          {lengths.map((l, i) => (
            <label className="field" key={l.seconds} htmlFor={`length-${l.seconds}`}>{l.seconds} sec %
              <input id={`length-${l.seconds}`} className="small" type="number" value={l.sharePct}
                onChange={(e) => setLengths(lengths.map((x, n) => (n === i ? { ...x, sharePct: Number(e.target.value) } : x)))} />
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>How vague terms were resolved</h2>
        <div className="scroll"><table>
          <thead><tr><th>Term in brief</th><th>Resolved as</th></tr></thead>
          <tbody>{brief.resolutions.map((r, i) => <tr key={i}><td>{r.term}</td><td>{r.meaning}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="panel"><h2>Original brief</h2><pre>{brief.rawText}</pre></section>

      <div><button className="primary" disabled={busy} onClick={confirm}>{busy ? 'Building plan…' : 'Confirm and build plan'}</button></div>
    </>
  );
}
