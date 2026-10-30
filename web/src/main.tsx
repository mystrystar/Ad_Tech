import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { get, PLANNER, type Approver } from './api';
import { Dashboard } from './Dashboard';
import { NewBrief } from './NewBrief';
import { ProposalPage } from './ProposalPage';
import './styles.css';

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => setHash(location.hash.slice(1) || '/');
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function App() {
  const hash = useHash();
  const [viewer, setViewer] = useState(PLANNER);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  useEffect(() => { get<Approver[]>('/approvers').then(setApprovers).catch(() => setApprovers([])); }, []);
  const proposalId = hash.match(/^\/p\/(.+)$/)?.[1];

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">Planner Copilot</a>
        <nav>
          <a href="#/">Dashboard</a>
          <a href="#/new">New brief</a>
        </nav>
        <label htmlFor="viewer">Viewing as
          <select id="viewer" value={viewer} onChange={(e) => setViewer(e.target.value)}>
            <option value={PLANNER}>Planner</option>
            {approvers.map((a) => <option key={a.id} value={a.id}>{a.name}, {a.title}</option>)}
          </select>
        </label>
      </header>
      <main className="page">
        {proposalId ? <ProposalPage key={proposalId} id={proposalId} viewer={viewer} approvers={approvers} />
          : hash === '/new' ? <NewBrief />
          : <Dashboard viewer={viewer} approvers={approvers} />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
