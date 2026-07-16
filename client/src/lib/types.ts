// Client-side types mirroring the server schema
export type Catalyst = {
  id: number;
  contentHash: string;
  title: string;
  summary: string;
  theme: string;
  sourceType: string;
  sourceUrl: string | null;
  strengthScore: number;
  firstSeenAt: number;
  lastSeenAt: number;
  rippleAnalyzed: boolean;
  rippleCostCredits: number;
};

export type GoldenEgg = {
  id: number;
  catalystId: number;
  ticker: string;
  companyName: string;
  thesis: string;
  hopDistance: number;
  confidence: number;
  noveltyScore: number;
  timingLag: "leading" | "concurrent" | "lagging";
  /** Canonical bucket (CANONICAL_SECTORS) — safe to group/filter by. */
  sector: string | null;
  /** The model's original, more specific string, e.g. "Industrials / Cash Logistics". */
  sectorDetail: string | null;
  ripplePath: string | null;
  priceAtFlag: number | null;
  priceAtFlagDate: number | null;
  currentPrice: number | null;
  priceRefreshedAt: number | null;
  createdAt: number;
};

export type GoldenEggWithCatalyst = GoldenEgg & {
  catalyst: { id: number; title: string; theme: string; sourceUrl: string | null };
  onWatchlist?: boolean;
};

export type GoldenEggDetail = GoldenEgg & {
  catalyst: {
    id: number;
    title: string;
    summary: string;
    theme: string;
    sourceType: string;
    sourceUrl: string | null;
    strengthScore: number;
    firstSeenAt: number;
    lastSeenAt: number;
  } | null;
  onWatchlist?: boolean;
};

export type PriceAlert = {
  id: number;
  eggId: number;
  direction: "gain" | "loss";
  thresholdPct: number;
  returnPct: number;
  priceAtAlert: number;
  createdAt: number;
  acknowledgedAt: number | null;
  ticker: string;
  companyName: string;
};

export type BacktestRow = {
  eggId: number;
  ticker: string;
  companyName: string;
  theme: string;
  sector: string | null;
  hopDistance: number;
  confidence: number;
  flagDate: string;
  flagClose: number | null;
  latestClose: number | null;
  returnPct: number | null;
  daysHeld: number;
  /** Flag price looks corrupt (placeholder/parse error) — excluded from rollups. */
  suspect?: boolean;
};

export type BacktestRollup = {
  key: string;
  count: number;
  wins: number;
  winRate: number;
  medianReturn: number | null;
  avgReturn: number | null;
};

export type BacktestResult = {
  rows: BacktestRow[];
  byTheme: BacktestRollup[];
  bySector: BacktestRollup[];
  byHop: BacktestRollup[];
  overall: {
    count: number;
    wins: number;
    winRate: number;
    medianReturn: number;
    avgReturn: number;
  } | null;
  generatedAt: number;
  /**
   * "close" = returns computed from real daily closes.
   * "spot"  = the provider's plan has no historical candles, so the latest
   *           refreshed quote stood in — returns are approximate.
   */
  priceSource?: "close" | "spot";
  /** How many rows were dropped from scoring due to a corrupt flag price. */
  suspectCount?: number;
};

export type GraphNode = {
  id: number;
  slug: string;
  name: string;
  kind: string;
  ticker: string | null;
  description: string | null;
  createdAt: number;
};

export type GraphEdge = {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  relation: string;
  strength: number;
  note: string | null;
};

export type ScanRun = {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  catalystsIngested: number;
  catalystsNew: number;
  eggsCreated: number;
  cacheHits: number;
  approxCredits: number;
  status: string;
  errorMessage: string | null;
};

export type RipplePath = Array<{ node: string; relation: string }>;
