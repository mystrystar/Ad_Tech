import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { dashboard } from './dashboard';
import { mock, store } from './data';
import { intakeBrief } from './modules/m1-intake';
import { formatFromFilename } from './modules/m1-intake/parsers';
import {
  acceptProposal, confirmBrief, createProposal, decideLength, decideRate, editPlan, plannerDiscountDecision,
  pricingFor, rebuild, rejectProposal, replanFromRejected, ReviewError, secondApproverDecision,
} from './modules/m5-review';
import type { Proposal, SourceFormat } from './types';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.json({ limit: '2mb' }));

const SAMPLES: Record<SourceFormat, string> = { email: 'brief-email.txt', pdf: 'brief.pdf', excel: 'brief.xlsx' };

const withPricing = (proposal: Proposal) => ({ ...proposal, pricing: pricingFor(proposal) });
const send = (res: Response, proposal: Proposal) => res.json(withPricing(proposal));
const param = (req: Request, name: string) => String(req.params[name]);

app.get('/api/dashboard', (_req, res) => { res.json(dashboard()); });
app.get('/api/approvers', (_req, res) => { res.json(mock.approvers); });
app.get('/api/knowledge-base', (_req, res) => { res.json(mock.knowledgeBase); });
app.get('/api/salesforce', (_req, res) => { res.json(store.salesforce()); });

app.post('/api/briefs/text', async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw new ReviewError('Paste the brief text first.');
  res.json(createProposal(await intakeBrief('email', Buffer.from(text))));
});
app.post('/api/briefs/file', upload.single('file'), async (req, res) => {
  if (!req.file) throw new ReviewError('Choose a file first.');
  const format = formatFromFilename(req.file.originalname);
  if (!format) throw new ReviewError('Upload a .txt, .eml, .pdf or .xlsx file.');
  res.json(createProposal(await intakeBrief(format, req.file.buffer)));
});
app.post('/api/briefs/sample/:format', async (req, res) => {
  const format = param(req, 'format') as SourceFormat;
  if (!SAMPLES[format]) throw new ReviewError('Unknown sample format.');
  res.json(createProposal(await intakeBrief(format, readFileSync(join(process.cwd(), 'samples', SAMPLES[format])))));
});

app.get('/api/proposals/:id', (req, res) => {
  const proposal = store.proposal(param(req, 'id'));
  if (!proposal) throw new ReviewError('Proposal not found.');
  send(res, proposal);
});
app.post('/api/proposals/:id/confirm', (req, res) => { send(res, confirmBrief(param(req, 'id'), req.body)); });
app.post('/api/proposals/:id/rate', (req, res) => { send(res, decideRate(param(req, 'id'), req.body.channelId, req.body.timeBand, req.body.decision)); });
app.post('/api/proposals/:id/length', (req, res) => { send(res, decideLength(param(req, 'id'), req.body.medium, req.body.seconds, req.body.decision)); });
app.post('/api/proposals/:id/discount/planner', (req, res) => { send(res, plannerDiscountDecision(param(req, 'id'), req.body.flagKey, req.body.decision, req.body.secondApproverId ?? null)); });
app.post('/api/proposals/:id/discount/second', (req, res) => { send(res, secondApproverDecision(param(req, 'id'), req.body.flagKey, req.body.approverId, req.body.decision)); });
app.post('/api/proposals/:id/edit', (req, res) => { send(res, editPlan(param(req, 'id'), req.body)); });
app.post('/api/proposals/:id/rebuild', (req, res) => { send(res, rebuild(param(req, 'id'))); });
app.post('/api/proposals/:id/accept', (req, res) => { send(res, acceptProposal(param(req, 'id'))); });
app.post('/api/proposals/:id/reject', (req, res) => { send(res, rejectProposal(param(req, 'id'), req.body.reason)); });
app.post('/api/proposals/:id/replan', (req, res) => { res.json(replanFromRejected(param(req, 'id'))); });

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ReviewError) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: error.message || 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT) || 3001;
// Local, single-user MVP with no login, so it only listens on this machine.
app.listen(port, '127.0.0.1', (error?: Error) => {
  if (error) {
    console.error(`Could not start the API on port ${port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Planner Copilot API on http://127.0.0.1:${port}`);
});
