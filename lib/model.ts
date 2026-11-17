// LaunchScope's model: one snapshot of the protocol universe in, one ranked board out.
//
// The idea: a pre-token protocol's token, if it ever issues one, would most plausibly trade the way
// comparable protocols that already trade do. So the multiple is not a constant and not a guess per
// name: it is calibrated from the snapshot itself. For every category, the live-token protocols in
// that category give a distribution of market cap per dollar of TVL; a pre-token protocol is valued
// at its category's median multiple, shrunk toward the global median when the category has few live
// peers to learn from, with the category's middle half (p25..p75) kept as the value band. Three
// further factors, all from the snapshot's own figures, adjust the anchor:
//
//   momentum  = 1 + clamp(change_7d, -60, 120) / 100 x 0.30   (a hot week is worth something, capped)
//   maturity  = 0.75 + 0.25 x sqrt(min(age_days, 1460) / 1460)   (a long tokenless record counts)
//   breadth   = 1 + 0.02 x min(chains - 1, 10)               (more chains, wider reach, small weight)
//
// One guard keeps the calibration honest: every peer ratio is winsorized at the global 95th
// percentile before any statistic is taken. A token whose protocol's TVL has collapsed since its
// launch (a legacy version, a market that moved elsewhere) can show a market cap hundreds of times
// its remaining TVL; left in, a single such peer would price a whole category. The cap is computed
// from the snapshot's own ratios, and the shrunk multiple is itself never above it.
//
//   implied   = max(1, round(tvl_usd x multiple x momentum x maturity x breadth))
//
// No protocol name is ever special-cased: one function scores every row, and the dashboard restates
// the calibration so a reader can check any row's arithmetic from the figures on its face.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so the page and the board cannot drift apart. */
export interface ModelConstants {
  shrink_k: number;
  winsor_quantile: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 4,
  winsor_quantile: 0.95,
  momentum_weight: 0.3,
  momentum_floor_pct: -60,
  momentum_cap_pct: 120,
  maturity_floor: 0.75,
  maturity_range: 0.25,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_extra: 10,
};

/** The model's version label: the dashboard names it and board rows carry it. */
export const MODEL_VERSION = 'launchscope-1';

/** How many live-token protocols the dashboard's Already trading view carries, by market cap. */
export const LIVE_ROWS = 40;

/** What one category's live-token protocols say a dollar of TVL is worth on the market. */
export interface PeerStats {
  peers: number;
  median: number;
  p25: number;
  p75: number;
}

/** The calibration: the global peer stats, one entry per category that has live peers, and the winsor cap every ratio was held to. */
export interface Calibration {
  global: PeerStats;
  by_category: Record<string, PeerStats>;
  winsor_cap: number;
}

/** One protocol's score: the implied value, its band, and every factor that produced it. */
export interface Score {
  age_days: number | null;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  peers: number;
  momentum: number;
  maturity: number;
  breadth: number;
  implied: number;
  implied_low: number;
  implied_high: number;
  radar_score: number;
}

/** A farm plan: the step strings the board carries, and the totals the detail view shows. */
export interface FarmPlan {
  steps: string[];
  capital_usd: number;
  fees_usd: number;
  weeks: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  radar_score: number;
  model: {
    multiple: number;
    multiple_low: number;
    multiple_high: number;
    peers: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  rows: Array<BoardRow & { plan: { capital_usd: number; fees_usd: number; weeks: number } }>;
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are products of another asset rather than protocols awaiting a launch. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token protocol is a launch candidate in its own right: the watchlist's product
 * exclusions, applied with the fields the snapshot carries (it carries no parent protocol, so that
 * one clause of the house's rule cannot be applied here and is not pretended to be).
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The value at quantile q of a sorted array, by nearest rank; 0 for an empty array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Peer stats for a set of market-cap-per-TVL ratios. */
function peerStats(ratios: number[]): PeerStats {
  const sorted = [...ratios].sort((a, b) => a - b);
  return { peers: sorted.length, median: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75) };
}

/**
 * Calibrate the multiples from the snapshot's live-token protocols: every protocol that records a
 * market cap over a positive TVL is one market observation of what a dollar of TVL is worth. Every
 * ratio is winsorized at the model's quantile of the global distribution before any statistic is
 * taken, so one collapsed-TVL outlier cannot price a category.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const raw: Array<{ category: string | null; ratio: number }> = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    raw.push({ category: p.category, ratio: p.mcap_usd / p.tvl_usd });
  }
  const cap = quantile(raw.map((r) => r.ratio).sort((a, b) => a - b), model.winsor_quantile);
  const all: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const r of raw) {
    const ratio = Math.min(r.ratio, cap);
    all.push(ratio);
    if (r.category !== null) {
      const list = perCategory.get(r.category) ?? [];
      list.push(ratio);
      perCategory.set(r.category, list);
    }
  }
  const by_category: Record<string, PeerStats> = {};
  for (const category of [...perCategory.keys()].sort()) by_category[category] = peerStats(perCategory.get(category)!);
  return { global: peerStats(all), by_category, winsor_cap: round4(cap) };
}

/** Shrink a category stat toward the global one: full weight only as the peer count grows. */
function shrunk(cat: PeerStats | undefined, global: PeerStats, key: 'median' | 'p25' | 'p75', k: number): number {
  if (cat === undefined || cat.peers === 0) return global[key];
  const w = cat.peers / (cat.peers + k);
  return w * cat[key] + (1 - w) * global[key];
}

/** Score one protocol: the peer-anchored implied value, its band, and a 0..100 radar score. */
export function score(p: SnapshotProtocol, asOf: string, calib: Calibration, model: ModelConstants = MODEL): Score {
  const cat = p.category !== null ? calib.by_category[p.category] : undefined;
  const multiple = Math.min(shrunk(cat, calib.global, 'median', model.shrink_k), calib.winsor_cap);
  const multipleLow = Math.min(shrunk(cat, calib.global, 'p25', model.shrink_k), calib.winsor_cap);
  const multipleHigh = Math.min(shrunk(cat, calib.global, 'p75', model.shrink_k), calib.winsor_cap);
  const peers = cat?.peers ?? 0;

  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum = 1 + (growthPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_floor + model.maturity_range * Math.sqrt(clamp(ageForModel, 0, model.maturity_days) / model.maturity_days);
  const breadth = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);

  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
  const impliedLow = clamp(Math.round(p.tvl_usd * multipleLow * momentum * maturity * breadth), 1, implied);
  const impliedHigh = Math.max(implied, Math.round(p.tvl_usd * multipleHigh * momentum * maturity * breadth));

  // The radar score is a triage aid, not the ranking: size, momentum, maturity, breadth, peer depth.
  const sizePts = 30 * clamp((Math.log10(Math.max(p.tvl_usd, 1)) - Math.log10(5_000_000)) / (Math.log10(5_000_000_000) - Math.log10(5_000_000)), 0, 1);
  const momentumPts = 25 * clamp(((p.change_7d ?? 0) + 20) / 70, 0, 1);
  const maturityPts = 20 * clamp(ageForModel / model.maturity_days, 0, 1);
  const breadthPts = 15 * clamp(p.chains.length / 12, 0, 1);
  const peerPts = 10 * clamp(peers / 20, 0, 1);
  const radar_score = Math.round(sizePts + momentumPts + maturityPts + breadthPts + peerPts);

  return {
    age_days: age,
    multiple: round4(multiple),
    multiple_low: round4(multipleLow),
    multiple_high: round4(multipleHigh),
    peers,
    momentum: round4(momentum),
    maturity: round4(maturity),
    breadth: round4(breadth),
    implied,
    implied_low: impliedLow,
    implied_high: impliedHigh,
    radar_score,
  };
}

// ---------------------------------------------------------------- farm plans

/** A chain's fee class: what one on-chain action costs there, in whole dollars, for plan estimates. */
interface FeeClass {
  label: string;
  setup: number;
  action: number;
  second: number;
  weekly: number;
  exit: number;
}

const CHEAP_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'Polygon', 'Binance', 'Avalanche', 'Linea', 'Scroll', 'Mantle',
  'Blast', 'zkSync Era', 'Unichain', 'Sonic', 'Berachain', 'xDai', 'Celo', 'Fantom', 'Cronos',
  'Plasma', 'Monad', 'Hyperliquid L1', 'Sui', 'Aptos', 'Near', 'Tron', 'Sei', 'X Layer', 'Taiko',
  'Mode', 'Katana', 'Ink', 'World Chain', 'Abstract', 'BOB', 'Manta', 'Metis', 'Moonbeam', 'Kava',
]);

function feeClass(chain: string): FeeClass {
  if (chain === 'Ethereum') return { label: 'Ethereum mainnet', setup: 5, action: 9, second: 7, weekly: 6, exit: 7 };
  if (chain === 'Solana') return { label: 'Solana', setup: 1, action: 1, second: 1, weekly: 1, exit: 1 };
  if (CHEAP_CHAINS.has(chain)) return { label: chain, setup: 1, action: 2, second: 1, weekly: 1, exit: 1 };
  return { label: chain, setup: 2, action: 3, second: 2, weekly: 2, exit: 2 };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How many weeks to run the plan, from the protocol's age: younger protocols span more snapshots. */
function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  if (age < 730) return 5;
  return 4;
}

/** The category's playbook: the core position and the second qualifying action, in a farmer's words. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  const usd = `$${capital}`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      core: `Supply ${usd} of USDC to ${n} on ${chain} as collateral in its main market and leave the position open.`,
      second: `Borrow a small amount against it (under 30% of the supplied value) and repay it a week later, so the wallet shows both sides of the market.`,
    };
  if (c.includes('dex'))
    return {
      core: `Add ${usd} of liquidity to ${n}'s busiest stablecoin or majors pool on ${chain} and keep the LP position in the wallet.`,
      second: `Make two swaps a week through ${n}'s own interface, so the wallet builds real trading volume and not just a deposit.`,
    };
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic'))
    return {
      core: `Deposit ${usd} of USDC as margin on ${n} and open one small position (under 2x leverage) on ${chain}.`,
      second: `Trade to a modest weekly volume of about $1,000 of notional with short-lived, hedged positions rather than one large bet.`,
    };
  if (c.includes('bridge'))
    return {
      core: `Bridge ${usd} of USDC to ${chain} through ${n} and use the bridged funds in one app on the far side.`,
      second: `Bridge a smaller amount back a week later, so the wallet shows completed round trips instead of one-way exits.`,
    };
  if (c.includes('restak') || c.includes('staking'))
    return {
      core: `Stake ${usd} of the chain's staking asset through ${n} on ${chain} and keep the receipt token in the wallet.`,
      second: `Re-deposit the receipt once through ${n}'s own vault or restaking market, so both layers record the wallet as a staker.`,
    };
  if (c.includes('prediction'))
    return {
      core: `Fund ${usd} on ${n} and take one position in its most liquid market.`,
      second: `Close that position before settlement and take a second one in a different market, so the wallet shows repeat trading.`,
    };
  if (c.includes('rwa'))
    return {
      core: `Mint ${usd} of ${n}'s yield-bearing asset on ${chain} and hold it in the wallet.`,
      second: `Make one redemption or secondary purchase through ${n}'s app, so the wallet shows a full mint-and-exit cycle as well as a hold.`,
    };
  if (c.includes('insurance'))
    return {
      core: `Buy ${usd} of cover from ${n} on ${chain} for the longest term it offers.`,
      second: `Stake a small amount in ${n}'s underwriting or capital pool if it offers one, and keep that position alongside the cover.`,
    };
  if (c.includes('stable') || c.includes('algo'))
    return {
      core: `Mint or deposit ${usd} of the stable asset through ${n} on ${chain} and hold it in the wallet.`,
      second: `Provide the stable asset to ${n}'s main liquidity pool as well, so the wallet is recorded as both a holder and a provider.`,
    };
  if (c.includes('launchpad'))
    return {
      core: `Deposit ${usd} through ${n} on ${chain} and take part in one live sale or allocation round.`,
      second: `Claim what the round issues and hold it, then join the next round instead of selling the first allocation at once.`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('farm') || c.includes('index') || c.includes('liquidity manager') || c.includes('basis'))
    return {
      core: `Deposit ${usd} of USDC into a ${n} vault on ${chain} and keep the vault shares in the wallet.`,
      second: `Put a second, smaller deposit into a different ${n} vault or strategy, so the wallet is active in more than one of its markets.`,
    };
  return {
    core: `Deposit ${usd} of USDC into ${n} on ${chain} through its own app and keep the position open.`,
    second: `Repeat the core action once a week later instead of doing everything in one day, so the activity spans more than one snapshot.`,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/**
 * A protocol's farm plan: seven steps derived from its own record (category, first chain, TVL, age),
 * each an action with a cost and a time, plus the plan's totals. The same derivation writes board.json
 * and the dashboard's data, so the page and the board cannot disagree.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmPlan {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const fees = feeClass(chain);
  const capital = capitalFor(p);
  const weeks = weeksFor(age);
  const { core, second } = playbook(p, capital, chain);
  const feesTotal = fees.setup + fees.action + fees.second + fees.weekly * weeks + fees.exit;
  const steps = [
    stepText(
      `Set up one fresh wallet for ${p.name} alone, fund it from an exchange (never from your main wallet), and keep its seed phrase offline.`,
      `about $${fees.setup} of network fees on ${fees.label}`,
      '10 minutes',
    ),
    stepText(core, `$${capital} of capital plus about $${fees.action} of network fees`, '20 minutes to set up'),
    stepText(second, `about $${fees.second} of network fees, no new capital`, '15 minutes'),
    stepText(
      `Repeat one qualifying action every week for ${weeks} weeks (a deposit, a swap, a vote or a claim check), always from the same wallet.`,
      `about $${fees.weekly} of network fees a week, $${fees.weekly * weeks} over the plan`,
      `10 minutes a week for ${weeks} weeks`,
    ),
    stepText(
      `Hold the position for the full ${weeks} weeks so the activity is counted in several weekly snapshots, not one.`,
      `the $${capital} stays in the position; withdrawing early ends the plan`,
      `${weeks} weeks`,
    ),
    stepText(
      `When a points, rewards or claim page appears, reach it only from ${p.name}'s official site or verified social account, and check the contract address before signing anything.`,
      'free to check; never pay a fee to claim an airdrop',
      '15 minutes',
    ),
    stepText(
      `Log the wallet, the dates and every transaction hash in a farm log, then unwind the position the way you entered it once the plan ends or a token launches.`,
      `about $${fees.exit} of network fees to exit`,
      '20 minutes',
    ),
  ];
  return { steps, capital_usd: capital, fees_usd: feesTotal, weeks };
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks: every watchlist slug, plus every other launch candidate. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calib = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug)) chosen.set(p.slug, p);
    else if (isCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const s = score(p, snapshot.as_of, calib, model);
    const plan = farmPlan(p, s.age_days);
    return { p, s, plan };
  });
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s, plan }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    implied_low_usd: s.implied_low,
    implied_high_usd: s.implied_high,
    radar_score: s.radar_score,
    model: {
      multiple: s.multiple,
      multiple_low: s.multiple_low,
      multiple_high: s.multiple_high,
      peers: s.peers,
      momentum_multiplier: s.momentum,
      maturity_multiplier: s.maturity,
      breadth_multiplier: s.breadth,
    },
    farm_steps: plan.steps,
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot, with each row's farm plan totals attached. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: calibrate(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    live_total: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    rows: board.map((row) => {
      const p = snapshot.protocols.find((x) => x.slug === row.slug)!;
      const plan = farmPlan(p, row.age_days);
      return { ...row, plan: { capital_usd: plan.capital_usd, fees_usd: plan.fees_usd, weeks: plan.weeks } };
    }),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.SCOPE=${JSON.stringify(radar)};\n`;
}
