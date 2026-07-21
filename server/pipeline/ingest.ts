/**
 * Ingestion v2 \u2014 pull catalyst signals from cheap, structured sources
 * and drop obvious noise BEFORE it burns a classifier credit.
 *
 * Sources:
 *   - SEC EDGAR full-text search: recent 8-K filings mentioning trending keywords
 *   - RSS feeds from policy/data agencies (free)
 *   - Finance market gainers via finance connector (no credit cost per docs)
 */
import crypto from "node:crypto";
import { storage } from "../storage";
import type { InsertCatalyst } from "@shared/schema";
import { getQuotes } from "./providers/quotes";
import { log } from "../logger";

const logger = log("ingest");

export type CatalystCandidate = Omit<InsertCatalyst, "id" | "rippleAnalyzed" | "rippleCostCredits">;

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);
const nowMs = () => Date.now();

// ---------------------------------------------------------------
// Regex noise filter \u2014 drops obvious junk BEFORE the LLM sees it.
// ---------------------------------------------------------------
const NOISE_PATTERNS: RegExp[] = [
  /\b(?:appointment|appoints|resigns|resignation|retires|steps down|elected to the board|nomin(?:ates|ee))\b/i,
  /\b(?:dividend (?:declared|payment|announcement)|quarterly dividend|special dividend)\b/i,
  /\bshare (?:repurchase|buyback)\b/i,
  /\bstock split\b/i,
  /\b(?:names? new (?:cfo|cto|coo|ceo|cmo)|new (?:chairman|president))\b/i,
  /\bearnings (?:beat|miss|estimates?)\b/i,
  /\bpress release\s*:\s*$/i,
];

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((r) => r.test(text));
}

/**
 * Resolve an RSS item link against its feed URL.
 *
 * Some feeds (EIA, notably) emit relative links like "/pressroom/releases/
 * press587.php". Stored raw, those render as dead "source" links in the UI and
 * in exports. Returns null when there's nothing usable rather than a broken href.
 */
export function resolveLink(link: string | null | undefined, feedUrl: string): string | null {
  const raw = link?.trim();
  if (!raw) return null;
  try {
    // Absolute input is returned unchanged; relative is resolved against the feed.
    return new URL(raw, feedUrl).href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// SEC EDGAR \u2014 recent 8-K filings for a keyword
// ---------------------------------------------------------------
export async function ingestSecEightK(themes: string[], perTheme = 3): Promise<CatalystCandidate[]> {
  const out: CatalystCandidate[] = [];
  for (const theme of themes) {
    try {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + theme + '"')}&forms=8-K&dateRange=custom&startdt=${dateNDaysAgo(7)}&enddt=${today()}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "GoldenEgg Research contact@example.com" },
      });
      if (!res.ok) continue;
      const data: any = await res.json();
      const hits = (data?.hits?.hits ?? []).slice(0, perTheme);
      for (const h of hits) {
        const src = h._source ?? {};
        const title = (src.display_names?.[0] ?? "Company") + " \u2014 8-K: " + (src.forms ?? "8-K");
        const summary = (src.description ?? theme).slice(0, 400);
        const combined = `${title} ${summary}`;
        if (isNoise(combined)) continue;
        const filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.ciks?.[0] ?? ""}&type=8-K`;
        out.push({
          contentHash: hash(`sec:${h._id}`),
          title,
          summary: `${summary} \u2014 flagged for theme: ${theme}`,
          theme,
          sourceType: "sec_8k",
          sourceUrl: filingUrl,
          strengthScore: 0.5,
          firstSeenAt: nowMs(),
          lastSeenAt: nowMs(),
        });
      }
    } catch (e) {
      logger.warn({ err: e, theme }, "SEC ingest failed");
    }
  }
  return out;
}

// ---------------------------------------------------------------
// RSS ingestion \u2014 policy + data agencies (high-signal, low-noise)
// ---------------------------------------------------------------
const RSS_FEEDS: { url: string; source: string; theme: string }[] = [
  {
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    source: "Federal Reserve",
    theme: "monetary policy",
  },
  { url: "https://www.energy.gov/rss.xml", source: "DOE", theme: "energy policy" },
  { url: "https://www.eia.gov/rss/press_rss.xml", source: "EIA", theme: "energy data" },
  {
    url: "https://www.federalregister.gov/api/v1/documents.rss?conditions%5Btype%5D%5B%5D=RULE&conditions%5Btype%5D%5B%5D=PRORULE&per_page=25",
    source: "Federal Register",
    theme: "US regulation",
  },
  {
    url: "https://ustr.gov/about-us/policy-offices/press-office/press-releases/rss.xml",
    source: "USTR",
    theme: "trade & tariffs",
  },
  { url: "https://www.bls.gov/feed/news_release/atus.rss", source: "BLS", theme: "labor economics" },
  {
    url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=25",
    source: "DoD Contracts",
    theme: "defense procurement",
  },
  {
    url: "https://www.nrc.gov/public-involve/public-meetings/schedule.rss",
    source: "NRC",
    theme: "nuclear regulation",
  },
  {
    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    source: "FDA",
    theme: "drug approvals",
  },
];

export async function ingestRss(): Promise<CatalystCandidate[]> {
  const out: CatalystCandidate[] = [];
  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "User-Agent": "GoldenEgg/1.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssItems(xml).slice(0, 6);
      for (const it of items) {
        const combined = `${it.title} ${it.description}`;
        if (isNoise(combined)) continue;
        const key = `rss:${feed.source}:${it.link || it.title}`;
        out.push({
          contentHash: hash(key),
          title: it.title.slice(0, 200),
          summary: it.description.slice(0, 400),
          theme: feed.theme,
          sourceType: "rss",
          sourceUrl: resolveLink(it.link, feed.url),
          strengthScore: 0.4,
          firstSeenAt: nowMs(),
          lastSeenAt: nowMs(),
        });
      }
    } catch (e) {
      logger.warn({ err: e, source: feed.source }, "RSS ingest failed");
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Commodity/market signals via the quotes provider (day-gainers screener)
// ---------------------------------------------------------------
export async function ingestMarketSignals(): Promise<CatalystCandidate[]> {
  const out: CatalystCandidate[] = [];
  try {
    const rows = (await getQuotes().marketGainers()).slice(0, 12);
    for (const r of rows) {
      const sym = r.symbol;
      const name = r.name || sym;
      const changePct = r.changePct;
      if (!sym) continue;
      const title = `Market signal: ${sym} (${name}) up ${changePct}`;
      if (isNoise(title)) continue;
      out.push({
        contentHash: hash(`gainer:${sym}:${today()}`),
        title,
        summary: `${sym} \u2014 ${name} \u2014 today's top-mover. Investigate underlying catalyst.`,
        theme: "market signal",
        sourceType: "market_signal",
        sourceUrl: `https://www.marketwatch.com/investing/stock/${sym}`,
        strengthScore: 0.35,
        firstSeenAt: nowMs(),
        lastSeenAt: nowMs(),
      });
    }
  } catch (e) {
    logger.warn({ err: e }, "market signal ingest failed");
  }
  return out;
}

// ---------------------------------------------------------------
// Financial news — earnings, M&A, deals (via the quotes provider's news API)
// ---------------------------------------------------------------
// The policy/regulatory feeds miss catalysts that first surface in deal
// announcements and earnings guidance. Finnhub's "merger" category is already
// targeted; "general" is a firehose, so it only passes a strict keyword gate.
const FINANCIAL_SIGNAL =
  /\b(acquir\w*|merger|takeover|buyout|divest\w*|spin[- ]?off|raises? (?:full[- ]year )?guidance|cuts? guidance|multi[- ]?year contract|contract award\w*|awarded a? ?\$|capacity expansion|expands? (?:production|capacity|plant)|invest(?:s|ing|ment)? (?:of )?\$?\d+(?:\.\d+)? ?billion)\b/i;

export function newsToCandidate(
  n: { id: string; headline: string; summary: string; url: string | null; datetime: number },
  category: string
): CatalystCandidate | null {
  const combined = `${n.headline} ${n.summary}`;
  if (isNoise(combined)) return null;
  if (category !== "merger" && !FINANCIAL_SIGNAL.test(combined)) return null;
  return {
    contentHash: hash(`news:${n.id}`),
    title: n.headline.slice(0, 200),
    summary: (n.summary || n.headline).slice(0, 400),
    theme: category === "merger" ? "M&A activity" : "financial news",
    sourceType: "financial_news",
    sourceUrl: n.url,
    strengthScore: 0.4,
    firstSeenAt: n.datetime || nowMs(),
    lastSeenAt: nowMs(),
  };
}

export async function ingestFinancialNews(): Promise<CatalystCandidate[]> {
  const provider = getQuotes();
  if (!provider.marketNews) return [];
  const out: CatalystCandidate[] = [];
  for (const category of ["merger", "general"]) {
    try {
      const items = await provider.marketNews(category);
      let kept = 0;
      for (const n of items) {
        if (kept >= 8) break; // cap per category — the classifier bounds cost, but don't flood it
        const cand = newsToCandidate(n, category);
        if (!cand) continue;
        out.push(cand);
        kept++;
      }
    } catch (e) {
      logger.warn({ err: e, category }, "financial news ingest failed");
    }
  }
  return out;
}

// ---------------------------------------------------------------
// RSS parser
// ---------------------------------------------------------------
function parseRssItems(xml: string): { title: string; link: string; description: string }[] {
  const items: { title: string; link: string; description: string }[] = [];
  const itemRegex = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/g;
  const matches = xml.match(itemRegex) ?? [];
  for (const m of matches) {
    const title = extract(m, "title");
    const link = extract(m, "link") || extractAttr(m, "link", "href") || "";
    const description = extract(m, "description") || extract(m, "summary") || extract(m, "content") || "";
    if (title)
      items.push({ title: cleanText(title), link: cleanText(link), description: cleanText(description) });
  }
  return items;
}
function extract(str: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = str.match(re);
  return m ? m[1] : "";
}
function extractAttr(str: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, "i");
  const m = str.match(re);
  return m ? m[1] : "";
}
function cleanText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------
export async function persistCandidates(candidates: CatalystCandidate[]) {
  let newCount = 0;
  const ts = nowMs();
  for (const c of candidates) {
    const existing = await storage.getCatalystByHash(c.contentHash);
    if (existing) {
      await storage.touchCatalyst(existing.id, ts);
      continue;
    }
    await storage.createCatalyst({ ...c, rippleAnalyzed: false, rippleCostCredits: 0 });
    newCount++;
  }
  return { total: candidates.length, newCount };
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------
function today() {
  return new Date().toISOString().slice(0, 10);
}
function dateNDaysAgo(n: number) {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

// Themes to scan the SEC for. Kept small on purpose \u2014 cheap and focused.
export const SCAN_THEMES = [
  "artificial intelligence datacenter",
  "GLP-1 obesity",
  "small modular reactor",
  "reshoring manufacturing",
  "electric vehicle battery",
  "sports betting",
  "cash logistics",
  "quantum computing",
  "critical minerals",
  "defense contract award",
];
