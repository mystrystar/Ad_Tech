import { useState } from 'react';
import { post, uploadBrief, type Proposal } from './api';

export function NewBrief() {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (action: () => Promise<Proposal>) => {
    setBusy(true);
    setError('');
    try {
      location.hash = `#/p/${(await action()).id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="head"><h1>New brief</h1>{busy && <span className="sub">Reading the brief…</span>}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="panel">
        <h2>Try the sample brief</h2>
        <p className="sub">The same fictional brief in each of the three formats.</p>
        <div className="row">
          <button disabled={busy} onClick={() => submit(() => post('/briefs/sample/email'))}>Email text</button>
          <button disabled={busy} onClick={() => submit(() => post('/briefs/sample/pdf'))}>PDF</button>
          <button disabled={busy} onClick={() => submit(() => post('/briefs/sample/excel'))}>Excel</button>
        </div>
      </section>
      <section className="panel">
        <h2>Paste email text</h2>
        <textarea id="brief-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the agency's email here" />
        <div><button className="primary" disabled={busy || !text.trim()} onClick={() => submit(() => post('/briefs/text', { text }))}>Read this brief</button></div>
      </section>
      <section className="panel">
        <h2>Upload a file</h2>
        <p className="sub">.txt, .eml, .pdf (with readable text, not a scan) or .xlsx, up to 10 MB.</p>
        <div className="row">
          <input id="brief-file" type="file" accept=".txt,.eml,.pdf,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="primary" disabled={busy || !file} onClick={() => submit(() => uploadBrief(file!))}>Read this brief</button>
        </div>
      </section>
    </>
  );
}
