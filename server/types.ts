// Records passed between modules: M1 BriefRecord -> M2 InventoryRecord -> M3 PricingRecord -> M4 PlanRecord -> M5 Proposal -> M6 SalesforceRecord
export type Medium = 'linear' | 'ott';
export type TimeBand = 'peak' | 'slow';
export type TargetMedium = Medium | 'both';
export type SourceFormat = 'email' | 'pdf' | 'excel';

// ---------- Mock data rows ----------
export interface Channel { id: string; name: string; genre: string; medium: Medium; regions: string[] }
export interface BookedAdvertiser { advertiser: string; category: string }
export interface InventoryRow {
  id: string; channelId: string; date: string; timeBand: TimeBand; break: string;
  secondsAvailable?: number; impressionsAvailable?: number;
  booked: BookedAdvertiser[]; verified: 'no';
}
export interface RateCardRow {
  channelId: string; timeBand: TimeBand; adLength: number | null;
  ratePer10Sec?: number; ratePerImpression?: number; validFrom: string; validTo: string;
}
export interface AllowedLength { medium: Medium; minSeconds: number; maxSeconds: number }
export interface DiscountLimit { scope: 'channel' | 'genre'; key: string; maxDiscountPct: number }
export interface LastYearDeal {
  agency: string; client: string; channelId: string; timeBand: TimeBand;
  ratePaid: number; startDate: string; endDate: string;
}
export interface AudienceRow { channelId: string; audience: string; nccs: string; region: string; reachThousands: number }
export interface Approver { id: string; name: string; title: string }

// ---------- M1 ----------
export interface RawBrief {
  agency: string | null; client: string | null; category: string | null;
  budgetText: string | null; startDateText: string | null; endDateText: string | null;
  audience: string | null; nccsText: string | null; regionTexts: string[];
  genrePhrases: string[]; adLengthPhrases: string[];
  rateInstructionText: string | null; separationRuleText: string | null;
}
export interface Resolution { term: string; meaning: string }
export interface GenreRequest { raw: string; genre: string; medium: Medium; sharePct: number }
export interface LengthRequest { raw: string; seconds: number; sharePct: number }
export interface BriefRecord {
  sourceFormat: SourceFormat;
  parsedBy: 'agent' | 'fallback_rules';
  parserNote: string | null;
  rawText: string;
  agency: string | null;
  client: string | null;
  category: string | null;
  budget: {
    raw: string | null; total: number | null; allIn: boolean; taxPct: number;
    tolerancePct: number; mediaBudget: number | null; min: number | null; max: number | null;
  };
  startDate: string | null;
  endDate: string | null;
  audience: string | null;
  nccs: string[];
  regions: { raw: string[]; states: string[] };
  genres: GenreRequest[];
  targetMedium: TargetMedium | null;
  adLengths: LengthRequest[];
  rateInstruction: { raw: string | null; type: 'same_as_last_year' | 'rate_card' };
  separationRule: { raw: string | null; blockedCategory: string | null; scope: 'same_break' };
  resolutions: Resolution[];
  missingFields: string[];
}

// ---------- M2 ----------
export interface EligibleChannel { channel: Channel; reachThousands: number }
export interface InventoryRecord {
  free: InventoryRow[];
  blocked: { rowId: string; channelId: string; reason: string }[];
  eligibleChannels: EligibleChannel[];
  excludedChannels: { channelId: string; name: string; reason: string }[];
  verified: 'no';
}

// ---------- M3 ----------
export type RateChoice = 'rate_card' | 'last_year' | 'manual';
export interface PriceOption {
  channelId: string; channelName: string; genre: string; medium: Medium; timeBand: TimeBand;
  rateUnit: 'per_10_sec' | 'per_impression';
  cardRate: number; lastYearRate: number | null; chosenRate: number; rateSource: RateChoice;
  hasConflict: boolean; limitPct: number; discountPct: number; breach: boolean;
  discountIfLastYearPct: number | null; breachIfLastYear: boolean;
  freeUnits: number; reachThousands: number;
}
export interface PricingRecord { options: PriceOption[]; unpriced: { channelId: string; timeBand: TimeBand }[] }

// ---------- M4 ----------
export interface PlanLine {
  id: string; channelId: string; channelName: string; genre: string; medium: Medium; timeBand: TimeBand;
  adLength: number; unitType: 'spots' | 'impressions'; units: number;
  rateUnit: 'per_10_sec' | 'per_impression'; cardRate: number; rate: number; rateSource: RateChoice;
  amount: number; slotIds: string[];
}
export interface BudgetStatus { total: number; target: number; min: number; max: number; state: 'within' | 'under' | 'over' }
export interface LengthCheck { medium: Medium; seconds: number; minSeconds: number; maxSeconds: number; ok: boolean }
export interface PlanRecord { lines: PlanLine[]; budget: BudgetStatus; lengthChecks: LengthCheck[]; notes: string[] }

// ---------- M5 ----------
export type FlagType = 'unverified_inventory' | 'rate_conflict' | 'discount_breach' | 'ad_length_mismatch' | 'budget' | 'parser_fallback';
export type FlagStatus =
  | 'info' | 'open' | 'decided' | 'acknowledged' | 'removed'
  | 'pending_planner' | 'pending_second_approver' | 'approved' | 'refused';
export interface Flag {
  key: string; type: FlagType; status: FlagStatus; blocking: boolean; message: string;
  channelId?: string; timeBand?: TimeBand; rate?: number; cardRate?: number; lastYearRate?: number;
  discountPct?: number; limitPct?: number; medium?: Medium; seconds?: number; secondApproverId?: string | null;
}
export interface DiscountApproval {
  plannerDecision: 'approved' | 'refused'; secondApproverId: string | null;
  secondDecision: 'approved' | 'refused' | null;
}
export interface ProposalVersion { version: number; at: string; action: string; total: number; lineCount: number }
export type ProposalStatus = 'awaiting_confirmation' | 'in_review' | 'accepted' | 'rejected';
export interface Proposal {
  id: string; createdAt: string; updatedAt: string; status: ProposalStatus;
  brief: BriefRecord;
  rateDecisions: Record<string, RateChoice>;
  lengthDecisions: Record<string, 'keep' | 'remove'>;
  discountApprovals: Record<string, DiscountApproval>;
  plan: PlanRecord | null;
  inventorySummary: { freeCount: number; blockedCount: number; excludedChannels: InventoryRecord['excludedChannels'] } | null;
  flags: Flag[];
  versions: ProposalVersion[];
  rejectionReason: string | null;
  salesforceRecordId: string | null;
}
export interface ApprovalLogEntry {
  id: string; proposalId: string; flagKey: string; flagType: FlagType; flag: string;
  plannerDecision: string; secondApprover: string | null; status: string; updatedAt: string;
}

// ---------- M6 ----------
export interface SalesforceRecord {
  id: string; opportunityName: string; agency: string; client: string; amount: number;
  startDate: string; endDate: string; status: string; proposalId: string; createdAt: string;
  lineItems: { channel: string; timeBand: TimeBand; lengthSeconds: number; unitType: string; units: number; rate: number; rateUnit: string; amount: number }[];
}
