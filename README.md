# Planner Copilot

Turns TV + OTT ad briefs (email text, PDF or Excel) into a priced proposal. The planner reviews every flag and accepts, edits or rejects. All data is fictional mock data, and Salesforce is a mock record.

## Run it

```
npm install
npm run dev
```

Open http://127.0.0.1:5173. `.env` needs `OPENAI_API_KEY`, `OPENAI_MODEL` and `PORT`. Without a working key, briefs are read by basic text rules and the proposal shows a warning.

`npm run data` regenerates the mock data and sample briefs. To reset the app, delete `data/runtime/`.

## How it works

Each module takes the previous module's record and returns its own (see `server/types.ts`).

| Module | File | Output |
|---|---|---|
| M0 Knowledge base | `server/modules/m0-knowledge.ts` | Term, region and mix lookups |
| M1 Brief intake | `server/modules/m1-intake/` | `BriefRecord` |
| M2 Inventory check | `server/modules/m2-inventory.ts` | `InventoryRecord` |
| M3 Pricing | `server/modules/m3-pricing.ts` | `PricingRecord` |
| M4 Plan builder | `server/modules/m4-plan.ts` | `PlanRecord` |
| M5 Review and approval | `server/modules/m5-review.ts` | `Proposal` |
| M6 Salesforce (mock) | `server/modules/m6-salesforce.ts` | `SalesforceRecord` |
| Dashboard | `server/dashboard.ts`, `web/src/Dashboard.tsx` | Status, flags, approvals |

One OpenAI agent is used, in M1 only, to copy fields out of the brief. Everything after that is plain code, so the same record always gives the same plan.

To add a brief format, add a parser to `server/modules/m1-intake/parsers.ts`.

## Rules to change in mock data

Business rules live in `data/` and are regenerated from `scripts/generate-mock-data.ts`:

- "around" = ±5%, "all in" = includes 18% GST
- Mix: strong 60, some 15, digital 25; mostly 80, few 20
- Linear ad length limit: 10 to 60 sec; OTT: 40 to 90 sec
