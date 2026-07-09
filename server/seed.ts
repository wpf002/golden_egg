/**
 * Seed the supply-chain graph with well-known "gold rush" chains and a
 * handful of pre-analyzed catalysts + golden eggs so the app is useful
 * from the very first page load — before any scan has run.
 *
 * Run with:  npx tsx server/seed.ts
 *
 * All chains are documented public-market relationships. Nothing is trading advice.
 */
import { storage } from "./storage";
import type { InsertNode, InsertEdge, InsertCatalyst, InsertGoldenEgg } from "@shared/schema";

const now = Date.now();

// --------------------------------------------------------------------------
// Chains: each is [catalyst_theme, hops...] where each hop is a node spec
// --------------------------------------------------------------------------
type NodeSpec = { slug: string; name: string; kind: InsertNode["kind"]; ticker?: string; description?: string };
type Chain = {
  theme: string;
  root: NodeSpec;        // the catalyst/industry
  hops: Array<{ node: NodeSpec; relation: "supplies" | "depends_on" | "co_moves" | "uses" | "substitutes"; strength?: number; note?: string; from?: string /* slug of prior node, defaults to root */ }>;
};

const chains: Chain[] = [
  // === AI INFRASTRUCTURE ===
  {
    theme: "AI datacenter buildout",
    root: { slug: "ai-datacenter", name: "AI Datacenters", kind: "industry", description: "Hyperscale compute infrastructure for AI training and inference" },
    hops: [
      { node: { slug: "nvidia", name: "NVIDIA", kind: "company", ticker: "NVDA" }, relation: "supplies", strength: 0.95, note: "GPU accelerators" },
      { node: { slug: "amd", name: "AMD", kind: "company", ticker: "AMD" }, relation: "supplies", strength: 0.75, note: "MI300 accelerators" },
      { node: { slug: "broadcom", name: "Broadcom", kind: "company", ticker: "AVGO" }, relation: "supplies", strength: 0.85, note: "Custom ASICs, networking silicon" },
      { node: { slug: "hbm-memory", name: "HBM Memory", kind: "material", description: "High Bandwidth Memory stacks" }, relation: "uses", strength: 0.95, from: "nvidia" },
      { node: { slug: "sk-hynix", name: "SK Hynix", kind: "company", ticker: "HXSCL", description: "HBM leader" }, relation: "supplies", strength: 0.9, from: "hbm-memory" },
      { node: { slug: "micron", name: "Micron", kind: "company", ticker: "MU" }, relation: "supplies", strength: 0.75, from: "hbm-memory" },
      { node: { slug: "tsmc", name: "TSMC", kind: "company", ticker: "TSM" }, relation: "supplies", strength: 0.95, from: "nvidia", note: "Advanced node fabrication" },
      { node: { slug: "asml", name: "ASML", kind: "company", ticker: "ASML" }, relation: "supplies", strength: 0.95, from: "tsmc", note: "EUV lithography" },
      { node: { slug: "applied-materials", name: "Applied Materials", kind: "company", ticker: "AMAT" }, relation: "supplies", strength: 0.8, from: "tsmc" },
      { node: { slug: "lam-research", name: "Lam Research", kind: "company", ticker: "LRCX" }, relation: "supplies", strength: 0.8, from: "tsmc" },
      { node: { slug: "vertiv", name: "Vertiv", kind: "company", ticker: "VRT" }, relation: "supplies", strength: 0.85, note: "Datacenter cooling & power" },
      { node: { slug: "eaton", name: "Eaton", kind: "company", ticker: "ETN" }, relation: "supplies", strength: 0.75, note: "Electrical infrastructure" },
      { node: { slug: "quanta-services", name: "Quanta Services", kind: "company", ticker: "PWR" }, relation: "supplies", strength: 0.7, note: "Grid & datacenter buildout" },
      { node: { slug: "constellation-energy", name: "Constellation Energy", kind: "company", ticker: "CEG" }, relation: "supplies", strength: 0.7, note: "Nuclear power PPAs" },
      { node: { slug: "vistra", name: "Vistra", kind: "company", ticker: "VST" }, relation: "supplies", strength: 0.65, note: "Baseload power" },
      { node: { slug: "arista", name: "Arista Networks", kind: "company", ticker: "ANET" }, relation: "supplies", strength: 0.8, note: "Datacenter switching" },
      { node: { slug: "credo-tech", name: "Credo Technology", kind: "company", ticker: "CRDO" }, relation: "supplies", strength: 0.7, note: "Active electrical cables" },
      { node: { slug: "coherent", name: "Coherent Corp", kind: "company", ticker: "COHR" }, relation: "supplies", strength: 0.7, note: "Optical transceivers" },
      { node: { slug: "supermicro", name: "Super Micro", kind: "company", ticker: "SMCI" }, relation: "supplies", strength: 0.8, note: "AI server systems" },
      { node: { slug: "dell", name: "Dell", kind: "company", ticker: "DELL" }, relation: "supplies", strength: 0.7, note: "AI server systems" },
    ],
  },

  // === EV / BATTERIES ===
  {
    theme: "EV adoption & battery supply chain",
    root: { slug: "ev-adoption", name: "EV Adoption", kind: "industry" },
    hops: [
      { node: { slug: "lithium", name: "Lithium", kind: "commodity" }, relation: "uses", strength: 0.95 },
      { node: { slug: "albemarle", name: "Albemarle", kind: "company", ticker: "ALB" }, relation: "supplies", strength: 0.85, from: "lithium" },
      { node: { slug: "sqm", name: "SQM", kind: "company", ticker: "SQM" }, relation: "supplies", strength: 0.8, from: "lithium" },
      { node: { slug: "nickel", name: "Nickel", kind: "commodity" }, relation: "uses", strength: 0.85 },
      { node: { slug: "vale", name: "Vale", kind: "company", ticker: "VALE" }, relation: "supplies", strength: 0.7, from: "nickel" },
      { node: { slug: "copper", name: "Copper", kind: "commodity" }, relation: "uses", strength: 0.9, note: "EV uses 4x copper vs ICE" },
      { node: { slug: "freeport", name: "Freeport-McMoRan", kind: "company", ticker: "FCX" }, relation: "supplies", strength: 0.85, from: "copper" },
      { node: { slug: "southern-copper", name: "Southern Copper", kind: "company", ticker: "SCCO" }, relation: "supplies", strength: 0.75, from: "copper" },
      { node: { slug: "graphite", name: "Graphite (anode)", kind: "material" }, relation: "uses", strength: 0.85 },
      { node: { slug: "aehr-test", name: "Aehr Test Systems", kind: "company", ticker: "AEHR" }, relation: "supplies", strength: 0.6, note: "SiC wafer test" },
      { node: { slug: "wolfspeed", name: "Wolfspeed", kind: "company", ticker: "WOLF" }, relation: "supplies", strength: 0.65, note: "Silicon carbide power devices" },
      { node: { slug: "chargepoint", name: "ChargePoint", kind: "company", ticker: "CHPT" }, relation: "supplies", strength: 0.6, note: "Charging infrastructure" },
    ],
  },

  // === CBD / CANNABIS (the user's example) ===
  {
    theme: "CBD & cannabis cash-heavy operations",
    root: { slug: "cannabis-industry", name: "Cannabis / CBD industry", kind: "industry", description: "Federally illegal in US, forces cash-only operations at retail" },
    hops: [
      { node: { slug: "cash-logistics", name: "Cash logistics / armored transport", kind: "service" }, relation: "depends_on", strength: 0.85, note: "Banking limits force cash movement" },
      { node: { slug: "brinks", name: "Brink's Company", kind: "company", ticker: "BCO" }, relation: "supplies", strength: 0.8, from: "cash-logistics" },
      { node: { slug: "loomis", name: "Loomis AB", kind: "company", ticker: "LOIM.ST", description: "Global cash-in-transit" }, relation: "supplies", strength: 0.7, from: "cash-logistics" },
      { node: { slug: "armored-truck-oem", name: "Armored truck OEMs", kind: "industry" }, relation: "supplies", strength: 0.7, from: "cash-logistics" },
      { node: { slug: "commercial-truck-parts", name: "Commercial truck parts", kind: "industry" }, relation: "supplies", strength: 0.65, from: "armored-truck-oem" },
      { node: { slug: "allison-transmission", name: "Allison Transmission", kind: "company", ticker: "ALSN" }, relation: "supplies", strength: 0.6, from: "commercial-truck-parts" },
      { node: { slug: "cummins", name: "Cummins", kind: "company", ticker: "CMI" }, relation: "supplies", strength: 0.6, from: "commercial-truck-parts" },
      { node: { slug: "paccar", name: "PACCAR", kind: "company", ticker: "PCAR" }, relation: "supplies", strength: 0.6, from: "commercial-truck-parts" },
      { node: { slug: "safes-vaults", name: "Commercial safes & vaults", kind: "equipment" }, relation: "depends_on", strength: 0.75 },
      { node: { slug: "cannabis-packaging", name: "Child-resistant packaging", kind: "industry" }, relation: "depends_on", strength: 0.7 },
    ],
  },

  // === GLP-1 WEIGHT LOSS DRUGS ===
  {
    theme: "GLP-1 obesity drugs (Ozempic, Wegovy, Zepbound)",
    root: { slug: "glp1-drugs", name: "GLP-1 weight loss drugs", kind: "industry" },
    hops: [
      { node: { slug: "novo-nordisk", name: "Novo Nordisk", kind: "company", ticker: "NVO" }, relation: "supplies", strength: 0.95, note: "Ozempic, Wegovy" },
      { node: { slug: "eli-lilly", name: "Eli Lilly", kind: "company", ticker: "LLY" }, relation: "supplies", strength: 0.95, note: "Mounjaro, Zepbound" },
      { node: { slug: "auto-injector-pens", name: "Auto-injector pens", kind: "equipment" }, relation: "uses", strength: 0.9 },
      { node: { slug: "west-pharma", name: "West Pharmaceutical", kind: "company", ticker: "WST" }, relation: "supplies", strength: 0.85, from: "auto-injector-pens", note: "Elastomer components" },
      { node: { slug: "gerresheimer", name: "Gerresheimer", kind: "company", ticker: "GXI.DE" }, relation: "supplies", strength: 0.7, from: "auto-injector-pens" },
      { node: { slug: "novo-holdings-catalent", name: "Catalent (Novo-owned fill/finish)", kind: "service" }, relation: "supplies", strength: 0.75, note: "Fill/finish capacity" },
      { node: { slug: "reduced-food-consumption", name: "Reduced snack/soda consumption", kind: "industry" }, relation: "co_moves", strength: -0.4, note: "Users eat 20-30% less" },
      { node: { slug: "kidney-dialysis", name: "Kidney dialysis demand", kind: "industry" }, relation: "co_moves", strength: -0.5, note: "GLP-1s reduce diabetes complications" },
      { node: { slug: "davita", name: "DaVita", kind: "company", ticker: "DVA" }, relation: "depends_on", strength: -0.5, from: "kidney-dialysis" },
    ],
  },

  // === DEFENSE / MUNITIONS ===
  {
    theme: "Sustained munitions & defense demand",
    root: { slug: "defense-buildout", name: "Global defense buildout", kind: "industry" },
    hops: [
      { node: { slug: "lockheed", name: "Lockheed Martin", kind: "company", ticker: "LMT" }, relation: "supplies", strength: 0.9 },
      { node: { slug: "rtx", name: "RTX (Raytheon)", kind: "company", ticker: "RTX" }, relation: "supplies", strength: 0.9 },
      { node: { slug: "northrop", name: "Northrop Grumman", kind: "company", ticker: "NOC" }, relation: "supplies", strength: 0.85 },
      { node: { slug: "general-dynamics", name: "General Dynamics", kind: "company", ticker: "GD" }, relation: "supplies", strength: 0.85 },
      { node: { slug: "howmet", name: "Howmet Aerospace", kind: "company", ticker: "HWM" }, relation: "supplies", strength: 0.75, note: "Engine components, fasteners" },
      { node: { slug: "curtiss-wright", name: "Curtiss-Wright", kind: "company", ticker: "CW" }, relation: "supplies", strength: 0.7 },
      { node: { slug: "moog", name: "Moog Inc", kind: "company", ticker: "MOG.A" }, relation: "supplies", strength: 0.65, note: "Motion control for missiles/aircraft" },
      { node: { slug: "kratos", name: "Kratos Defense", kind: "company", ticker: "KTOS" }, relation: "supplies", strength: 0.7, note: "Unmanned systems" },
      { node: { slug: "aerojet-l3", name: "L3Harris", kind: "company", ticker: "LHX" }, relation: "supplies", strength: 0.75 },
      { node: { slug: "energetic-materials", name: "Energetic materials / propellants", kind: "material" }, relation: "uses", strength: 0.85 },
    ],
  },

  // === NUCLEAR RESURGENCE ===
  {
    theme: "Nuclear power resurgence (SMRs + relicensing)",
    root: { slug: "nuclear-resurgence", name: "Nuclear power resurgence", kind: "industry" },
    hops: [
      { node: { slug: "cameco", name: "Cameco", kind: "company", ticker: "CCJ" }, relation: "supplies", strength: 0.9, note: "Uranium mining" },
      { node: { slug: "uranium-enrichment", name: "Uranium enrichment", kind: "service" }, relation: "depends_on", strength: 0.9 },
      { node: { slug: "centrus-energy", name: "Centrus Energy", kind: "company", ticker: "LEU" }, relation: "supplies", strength: 0.8, from: "uranium-enrichment", note: "US HALEU" },
      { node: { slug: "bwx-tech", name: "BWX Technologies", kind: "company", ticker: "BWXT" }, relation: "supplies", strength: 0.85, note: "Nuclear components, naval reactors" },
      { node: { slug: "nuscale", name: "NuScale Power", kind: "company", ticker: "SMR" }, relation: "supplies", strength: 0.7, note: "Small modular reactors" },
      { node: { slug: "oklo", name: "Oklo", kind: "company", ticker: "OKLO" }, relation: "supplies", strength: 0.65, note: "Advanced reactors" },
      { node: { slug: "sprott-uranium", name: "Sprott Physical Uranium Trust", kind: "company", ticker: "SRUUF" }, relation: "co_moves", strength: 0.85 },
      { node: { slug: "uranium-royalty", name: "Uranium Royalty Corp", kind: "company", ticker: "UROY" }, relation: "co_moves", strength: 0.75 },
    ],
  },

  // === OZEMPIC-ADJACENT LOSERS + RE-COMP RETAIL ===
  {
    theme: "Reshoring US manufacturing",
    root: { slug: "reshoring", name: "US reshoring & CHIPS Act", kind: "industry" },
    hops: [
      { node: { slug: "eagle-materials", name: "Eagle Materials", kind: "company", ticker: "EXP" }, relation: "supplies", strength: 0.7, note: "Cement for factory builds" },
      { node: { slug: "vulcan-materials", name: "Vulcan Materials", kind: "company", ticker: "VMC" }, relation: "supplies", strength: 0.75, note: "Aggregates" },
      { node: { slug: "martin-marietta", name: "Martin Marietta", kind: "company", ticker: "MLM" }, relation: "supplies", strength: 0.75 },
      { node: { slug: "nucor", name: "Nucor", kind: "company", ticker: "NUE" }, relation: "supplies", strength: 0.8, note: "Steel for construction" },
      { node: { slug: "steel-dynamics", name: "Steel Dynamics", kind: "company", ticker: "STLD" }, relation: "supplies", strength: 0.7 },
      { node: { slug: "quanta-services2", name: "Quanta Services (grid)", kind: "company", ticker: "PWR" }, relation: "supplies", strength: 0.7 },
      { node: { slug: "emcor", name: "EMCOR Group", kind: "company", ticker: "EME" }, relation: "supplies", strength: 0.75, note: "Mechanical/electrical construction" },
      { node: { slug: "comfort-systems", name: "Comfort Systems USA", kind: "company", ticker: "FIX" }, relation: "supplies", strength: 0.75, note: "HVAC for datacenters/fabs" },
      { node: { slug: "wesco", name: "WESCO International", kind: "company", ticker: "WCC" }, relation: "supplies", strength: 0.7, note: "Electrical distribution" },
    ],
  },

  // === OBESITY DRUG DOWNSTREAM (packaging) ===
  {
    theme: "Sports betting / iGaming expansion",
    root: { slug: "sports-betting", name: "US sports betting legalization", kind: "industry" },
    hops: [
      { node: { slug: "draftkings", name: "DraftKings", kind: "company", ticker: "DKNG" }, relation: "supplies", strength: 0.9 },
      { node: { slug: "flutter", name: "Flutter Entertainment", kind: "company", ticker: "FLUT" }, relation: "supplies", strength: 0.9 },
      { node: { slug: "genius-sports", name: "Genius Sports", kind: "company", ticker: "GENI" }, relation: "supplies", strength: 0.7, note: "Sports data & streaming" },
      { node: { slug: "sportradar", name: "Sportradar", kind: "company", ticker: "SRAD" }, relation: "supplies", strength: 0.7, note: "Betting integrity data" },
      { node: { slug: "everi", name: "Everi Holdings", kind: "company", ticker: "EVRI" }, relation: "supplies", strength: 0.65, note: "Casino cash access / payments" },
      { node: { slug: "int-game-tech", name: "International Game Technology", kind: "company", ticker: "IGT" }, relation: "supplies", strength: 0.65 },
    ],
  },

  // === HYPERSCALER CAPEX ===
  {
    theme: "Hyperscaler capex ($200B+/yr on AI)",
    root: { slug: "hyperscaler-capex", name: "Hyperscaler capex", kind: "industry" },
    hops: [
      { node: { slug: "microsoft", name: "Microsoft", kind: "company", ticker: "MSFT" }, relation: "depends_on", strength: 0.9 },
      { node: { slug: "meta", name: "Meta Platforms", kind: "company", ticker: "META" }, relation: "depends_on", strength: 0.9 },
      { node: { slug: "alphabet", name: "Alphabet", kind: "company", ticker: "GOOGL" }, relation: "depends_on", strength: 0.9 },
      { node: { slug: "amazon", name: "Amazon (AWS)", kind: "company", ticker: "AMZN" }, relation: "depends_on", strength: 0.9 },
      { node: { slug: "digital-realty", name: "Digital Realty", kind: "company", ticker: "DLR" }, relation: "supplies", strength: 0.8, note: "Datacenter REIT" },
      { node: { slug: "equinix", name: "Equinix", kind: "company", ticker: "EQIX" }, relation: "supplies", strength: 0.8, note: "Datacenter REIT" },
      { node: { slug: "iron-mountain", name: "Iron Mountain", kind: "company", ticker: "IRM" }, relation: "supplies", strength: 0.65 },
    ],
  },
];

// --------------------------------------------------------------------------
// Pre-baked catalysts + eggs so app has day-one content
// --------------------------------------------------------------------------
type SeedCatalyst = {
  cat: InsertCatalyst;
  eggs: Omit<InsertGoldenEgg, "catalystId" | "createdAt">[];
};

const seedCatalysts: SeedCatalyst[] = [
  {
    cat: {
      contentHash: "seed:ai-power",
      title: "AI compute demand is bottlenecked by power, not chips",
      summary: "Multiple hyperscaler earnings calls flag grid interconnect queues of 5-7 years. Nuclear PPAs (Microsoft-Constellation, Amazon-Talen) reprice baseload power. This shifts the bottleneck upstream from GPUs to gas turbines, transformers, and switchgear.",
      theme: "AI infrastructure",
      sourceType: "seed",
      sourceUrl: null,
      strengthScore: 0.92,
      firstSeenAt: now,
      lastSeenAt: now,
      rippleAnalyzed: true,
      rippleCostCredits: 0,
    },
    eggs: [
      { ticker: "GEV", companyName: "GE Vernova", thesis: "Gas turbines have 5-7yr backlogs. GEV owns ~50% of US gas turbine share. Second-order beneficiary of AI power demand.", hopDistance: 2, confidence: 0.88, noveltyScore: 0.55, timingLag: "concurrent", sector: "Industrials", ripplePath: JSON.stringify([{node: "AI Datacenter", relation: "depends_on"}, {node: "Grid power", relation: "depends_on"}, {node: "Gas turbines", relation: "uses"}]), priceAtFlag: null, priceAtFlagDate: null },
      { ticker: "ETN", companyName: "Eaton", thesis: "Medium-voltage switchgear and transformer sub-assemblies for datacenters. 24-36 month lead times = pricing power.", hopDistance: 2, confidence: 0.82, noveltyScore: 0.4, timingLag: "concurrent", sector: "Industrials", ripplePath: JSON.stringify([{node: "AI Datacenter", relation: "depends_on"}, {node: "Electrical infra", relation: "uses"}]), priceAtFlag: null, priceAtFlagDate: null },
      { ticker: "VRT", companyName: "Vertiv Holdings", thesis: "Liquid cooling is required for H100/B200-class racks. Vertiv leads in datacenter thermal management.", hopDistance: 2, confidence: 0.85, noveltyScore: 0.35, timingLag: "concurrent", sector: "Technology", ripplePath: JSON.stringify([{node: "AI Datacenter", relation: "depends_on"}, {node: "Cooling", relation: "uses"}]), priceAtFlag: null, priceAtFlagDate: null },
      { ticker: "PWR", companyName: "Quanta Services", thesis: "Grid interconnect labor scarcity. Quanta is the largest US utility contractor and directly benefits from every new datacenter tie-in.", hopDistance: 3, confidence: 0.75, noveltyScore: 0.65, timingLag: "leading", sector: "Industrials", ripplePath: JSON.stringify([{node: "AI Datacenter", relation: "depends_on"}, {node: "Grid", relation: "depends_on"}, {node: "Utility construction labor", relation: "supplies"}]), priceAtFlag: null, priceAtFlagDate: null },
      { ticker: "CEG", companyName: "Constellation Energy", thesis: "Nuclear PPAs at premium pricing (Microsoft signed at ~$110/MWh vs ~$40 wholesale). Constellation owns the largest US nuclear fleet.", hopDistance: 2, confidence: 0.8, noveltyScore: 0.3, timingLag: "concurrent", sector: "Utilities", ripplePath: JSON.stringify([{node: "AI Datacenter", relation: "depends_on"}, {node: "Baseload power", relation: "uses"}]), priceAtFlag: null, priceAtFlagDate: null },
    ],
  },
  {
    cat: {
      contentHash: "seed:glp1-ripples",
      title: "GLP-1 adoption at scale changes food, dialysis, and packaging",
      summary: "GLP-1 users reduce calorie intake 20-30% and show meaningful drops in cardiovascular and renal events. Second-order effects: (a) packaged snack/soda demand pressure, (b) fewer new dialysis patients, (c) surging demand for injection-pen elastomer components.",
      theme: "GLP-1 second-order",
      sourceType: "seed",
      sourceUrl: null,
      strengthScore: 0.88,
      firstSeenAt: now,
      lastSeenAt: now,
      rippleAnalyzed: true,
      rippleCostCredits: 0,
    },
    eggs: [
      { ticker: "WST", companyName: "West Pharmaceutical Services", thesis: "Elastomer plungers and seals for GLP-1 auto-injectors. West is the near-monopoly supplier for injection pen components used by Novo & Lilly.", hopDistance: 1, confidence: 0.87, noveltyScore: 0.7, timingLag: "concurrent", sector: "Healthcare", ripplePath: JSON.stringify([{node: "GLP-1 drugs", relation: "uses"}, {node: "Auto-injector pens", relation: "uses"}]), priceAtFlag: null, priceAtFlagDate: null },
      { ticker: "GXI.DE", companyName: "Gerresheimer", thesis: "Glass cartridges and secondary packaging for injectable biologics. Capacity constrained.", hopDistance: 1, confidence: 0.72, noveltyScore: 0.75, timingLag: "concurrent", sector: "Healthcare", ripplePath: JSON.stringify([{node: "GLP-1 drugs", relation: "uses"}, {node: "Primary packaging", relation: "uses"}]), priceAtFlag: null, priceAtFlagDate: null },
    ],
  },
  {
    cat: {
      contentHash: "seed:cannabis-cash",
      title: "Cannabis remains federally illegal — cash logistics stays essential",
      summary: "SAFER Banking Act remains stalled. Every retail cannabis dollar moves as physical cash. Armored transport, safes, and vault services see structural demand from an industry with 25%+ y/y unit growth.",
      theme: "Cannabis cash logistics",
      sourceType: "seed",
      sourceUrl: null,
      strengthScore: 0.75,
      firstSeenAt: now,
      lastSeenAt: now,
      rippleAnalyzed: true,
      rippleCostCredits: 0,
    },
    eggs: [
      { ticker: "BCO", companyName: "Brink's Company", thesis: "Cash-in-transit is a duopoly (Brink's + Loomis). Cannabis is a small but fast-growing slice; more importantly, secular decline in cash is offset by cannabis + high-value logistics.", hopDistance: 2, confidence: 0.7, noveltyScore: 0.8, timingLag: "concurrent", sector: "Industrials", ripplePath: JSON.stringify([{node: "Cannabis industry", relation: "depends_on"}, {node: "Cash logistics", relation: "supplies"}]), priceAtFlag: null, priceAtFlagDate: null },
    ],
  },
];

// --------------------------------------------------------------------------
// Runner
// --------------------------------------------------------------------------
async function main() {
  console.log("Seeding supply-chain graph...");
  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const chain of chains) {
    const rootNode = await storage.upsertNode({ ...chain.root, createdAt: now });
    if (rootNode.createdAt === now) nodesCreated++;

    const nodeMap = new Map<string, number>();
    nodeMap.set(chain.root.slug, rootNode.id);

    for (const hop of chain.hops) {
      const created = await storage.upsertNode({ ...hop.node, createdAt: now });
      nodeMap.set(hop.node.slug, created.id);
      const fromId = nodeMap.get(hop.from ?? chain.root.slug);
      if (!fromId) {
        console.warn(`  missing 'from' node for ${hop.node.slug}`);
        continue;
      }
      await storage.createEdge({
        fromNodeId: fromId,
        toNodeId: created.id,
        relation: hop.relation,
        strength: hop.strength ?? 0.5,
        note: hop.note ?? null,
      });
      edgesCreated++;
    }
  }
  console.log(`  Graph seeded: ${nodesCreated} new nodes, ${edgesCreated} edges`);

  console.log("Seeding pre-baked catalysts + golden eggs...");
  let catCount = 0, eggCount = 0;
  for (const { cat, eggs } of seedCatalysts) {
    const existing = await storage.getCatalystByHash(cat.contentHash);
    if (existing) continue;
    const created = await storage.createCatalyst(cat);
    catCount++;
    for (const egg of eggs) {
      await storage.createEgg({ ...egg, catalystId: created.id, createdAt: now });
      eggCount++;
    }
  }
  console.log(`  Catalysts: ${catCount} new, Eggs: ${eggCount} new`);
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
