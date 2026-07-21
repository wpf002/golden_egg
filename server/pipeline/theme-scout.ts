/**
 * Theme scout — turns the classifier's reject pile into candidate NEW themes.
 *
 * The classifier only files catalysts under a fixed vocabulary, which is what
 * makes the ripple cache work — but it also means the next GLP-1 would be
 * rejected forever because no theme fits it yet. The scout looks at recent
 * catalysts that were analyzed but couldn't be placed, asks the cheap model to
 * cluster them into recurring themes, and stores the clusters as PROPOSALS.
 * Nothing changes until the user approves one; approval adds the name to
 * custom_themes and the classifier starts using it on the next scan.
 *
 * Cost control: runs at most once per scan, only when there are enough fresh
 * unplaced rejects that arrived after the last proposal round. One cheap-tier
 * call when it fires; zero when it doesn't.
 */
import { storage } from "../storage";
import { getLlm } from "./providers/llm";
import { extractJson } from "./ripple-utils";
import { activeThemes } from "./ripple";
import { log } from "../logger";

const logger = log("theme-scout");

const MIN_REJECTS = 5;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PROPOSALS = 3;

export type ParsedProposal = { name: string; rationale: string; evidence: string[] };

/**
 * Pure: validate/normalize the model's proposal JSON.
 * Drops proposals that duplicate an existing theme or prior proposal, have a
 * degenerate name, or cite fewer than two of the offered catalysts.
 */
export function parseProposals(
  parsed: unknown,
  opts: {
    existingThemes: string[];
    priorProposalNames: string[];
    titlesById: Map<number, string>;
  }
): ParsedProposal[] {
  const raw = ((parsed as { proposals?: unknown })?.proposals ?? []) as Array<Record<string, unknown>>;
  const taken = new Set(
    [...opts.existingThemes, ...opts.priorProposalNames].map((n) => n.trim().toLowerCase())
  );
  const out: ParsedProposal[] = [];
  for (const p of raw.slice(0, MAX_PROPOSALS)) {
    const name = String(p.name ?? "").trim();
    const rationale = String(p.rationale ?? "").trim();
    const ids = Array.isArray(p.catalyst_ids) ? p.catalyst_ids.map(Number) : [];
    const evidence = ids.map((id) => opts.titlesById.get(id)).filter((t): t is string => !!t);
    if (name.length < 4 || name.length > 48) continue;
    if (taken.has(name.toLowerCase())) continue;
    if (!rationale || evidence.length < 2) continue;
    taken.add(name.toLowerCase());
    out.push({ name, rationale, evidence: evidence.slice(0, 5) });
  }
  return out;
}

export async function scoutThemes(now = Date.now()): Promise<{ proposed: number }> {
  const rejects = await storage.listUnplacedRejects(now - LOOKBACK_MS, 40);
  if (rejects.length < MIN_REJECTS) return { proposed: 0 };

  // Only fire when there's genuinely new material since the last round —
  // otherwise every scan would re-litigate the same pile.
  const prior = await storage.listThemeProposals(50);
  const newestProposalAt = prior.reduce((m, p) => Math.max(m, p.createdAt), 0);
  const fresh = rejects.filter((r) => r.lastSeenAt > newestProposalAt);
  if (fresh.length < MIN_REJECTS) return { proposed: 0 };

  const existingThemes = await activeThemes();
  const items = rejects.map((c) => ({
    id: c.id,
    title: c.title.slice(0, 150),
    source_theme: c.theme,
    summary: c.summary.slice(0, 200),
  }));

  const prompt = `You are scouting for NEW investable market themes.

Below are recent catalysts a screener collected but could NOT file under any of
its current themes. Look for RECURRING patterns — a real theme shows up in
multiple independent catalysts, has plausible second-order beneficiaries in
public equities, and is not a one-off news event.

CURRENT THEMES (do NOT propose anything that overlaps these):
${existingThemes.map((t) => `- ${t}`).join("\n")}

${prior.length > 0 ? `ALREADY PROPOSED BEFORE (do NOT repeat): ${prior.map((p) => p.name).join("; ")}` : ""}

Unfiled catalysts:
${JSON.stringify(items, null, 2)}

Propose AT MOST ${MAX_PROPOSALS} themes; zero is a fine answer if nothing recurs.
Each: a short name (like the current themes' style), one-sentence rationale
focused on who benefits down the supply chain, and the ids of the catalysts
that evidence it (need at least 2).

Return ONLY JSON: {"proposals":[{"name":"...","rationale":"...","catalyst_ids":[1,2]}]}`;

  try {
    const text = await getLlm().complete(prompt, { tier: "cheap", maxTokens: 1000 });
    const titlesById = new Map(rejects.map((c) => [c.id, c.title]));
    const proposals = parseProposals(extractJson(text), {
      existingThemes,
      priorProposalNames: prior.map((p) => p.name),
      titlesById,
    });
    for (const p of proposals) {
      await storage.createThemeProposal({
        name: p.name,
        rationale: p.rationale,
        evidence: JSON.stringify(p.evidence),
        status: "pending",
        createdAt: now,
        decidedAt: null,
      });
    }
    if (proposals.length > 0) {
      logger.info({ proposed: proposals.map((p) => p.name) }, "theme scout proposed new themes");
    }
    return { proposed: proposals.length };
  } catch (e) {
    // Scouting is a bonus pass — a failure must never affect the scan.
    logger.warn({ err: e }, "theme scout failed");
    return { proposed: 0 };
  }
}
