// Deterministic generator for the synthetic claims library, entitlements and eval set.
//
//   npm run data                 regenerate everything
//   tsx data/generate.ts --if-missing   only if a file is missing (runs on npm install)
//
// Output (in this folder):
//   claims.json         50,000 claims across 200 brands and 4 pharma clients
//   entitlements.json   clients, brands, users and assets
//   eval_queries.json   300 typed fragments, each labelled with the claim the writer meant

import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CLOCK_START } from '../shared/clock';
import { createRng } from '../shared/random';
import type { Asset, Brand, Citation, Claim, Client, User } from '../shared/types';
import { cosine } from '../server/fakeEmbedder';
import { embedderWords, vectorFor } from './embeddingModel';
import {
  AREAS,
  COMPARATORS,
  CONDITIONS,
  CONTRAINDICATIONS,
  DOSING,
  ENDPOINTS,
  GENERIC,
  POPULATIONS,
  SIDE_EFFECTS,
  STOPWORDS,
  TIMES,
  type Area,
  type Concept,
  type Endpoint,
} from './concepts';
import { DATA_FILES, type EvalQuery } from './files';


const SEED = 20261013;
const TOTAL_CLAIMS = 50_000;
const BRAND_COUNT = 200;
const MIN_BRAND = 50;
const MAX_BRAND = 2000;
const DAY = 86_400_000;
const MINUTE = 60_000;

export const MARKETS = ['US', 'UK', 'DE', 'FR', 'JP', 'CA'];
export const CHANNELS = ['email', 'banner', 'web', 'print', 'social', 'rep_detail'];

const rng = createRng(SEED);
const rand = (n: number) => Math.floor(rng() * n);
const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)]!;
const chance = (p: number) => rng() < p;
function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}
function sample<T>(xs: readonly T[], n: number): T[] {
  return shuffle([...xs]).slice(0, n);
}

// ---------------------------------------------------------------------------
// Clients, brands
// ---------------------------------------------------------------------------

const CLIENTS: Client[] = [
  { id: 'cl_halvorsen', name: 'Halvorsen Pharma' },
  { id: 'cl_meridian', name: 'Meridian Biologics' },
  { id: 'cl_ostrava', name: 'Ostrava Therapeutics' },
  { id: 'cl_quillon', name: 'Quillon Health' },
];

const NAME_START = ['Car', 'Glu', 'Neu', 'Pul', 'Onc', 'Der', 'Rheu', 'Ven', 'Lor', 'Zan', 'Tri', 'Xel', 'Mav', 'Cor', 'Ser', 'Tal', 'Bry', 'Exa', 'Ilo', 'Nex', 'Vor', 'Pra', 'Sol', 'Ky'];
const NAME_MID = ['a', 'i', 'o', 'e', 'ova', 'ira', 'eta', 'ul', 'en'];
const NAME_END = ['vex', 'tra', 'lix', 'zen', 'dra', 'mab', 'tide', 'pril', 'stat', 'flo', 'nib', 'mune', 'gen', 'sorb', 'vance', 'quil'];

interface GenBrand extends Brand {
  area: Area;
  markets: string[];
  size: number;
  studies: string[];
  citations: Citation[];
}

const STUDY_NAMES = ['ORBIT', 'SUMMIT', 'HORIZON', 'VECTOR', 'ZENITH', 'APEX', 'PINNACLE', 'ATLAS', 'BEACON', 'CREST', 'EMBER', 'FALCON', 'GALAXY', 'HARBOR', 'IRIS', 'JUNO', 'KESTREL', 'LUMEN', 'NOVA', 'ONYX', 'POLARIS', 'QUASAR', 'RADIANT', 'SIERRA', 'TITAN', 'UNITY', 'VOYAGER', 'WAYPOINT'];
const SURNAMES = ['Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Ramirez', 'Novak', 'Haddad', 'Fischer', "O'Brien", 'Kowalski', 'Singh', 'Duarte', 'Achebe', 'Nakamura', 'Petrov', 'Whitfield'];
const JOURNALS = ['N Engl J Med', 'Lancet', 'JAMA', 'Circulation', 'Diabetes Care', 'J Clin Oncol', 'Am J Respir Crit Care Med', 'Neurology', 'J Am Acad Dermatol', 'Ann Rheum Dis'];

let citationSeq = 10000;

function makeBrands(): GenBrand[] {
  const names = new Set<string>();
  while (names.size < BRAND_COUNT) names.add(pick(NAME_START) + pick(NAME_MID) + pick(NAME_END));
  const nameList = shuffle([...names]);

  // Skewed sizes: most brands are small, a few are large. Sum is exactly TOTAL_CLAIMS.
  const weights = nameList.map(() => Math.exp(1.1 * gaussian()));
  const budget = TOTAL_CLAIMS - BRAND_COUNT * MIN_BRAND;
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.min(MAX_BRAND, MIN_BRAND + Math.floor((w / sumW) * budget)));
  sizes[0] = MAX_BRAND; // at least one brand at the documented maximum
  let diff = TOTAL_CLAIMS - sizes.reduce((a, b) => a + b, 0);
  for (let i = 1; diff !== 0; i = (i % (BRAND_COUNT - 1)) + 1) {
    const step = diff > 0 ? 1 : -1;
    const next = sizes[i]! + step;
    if (next >= MIN_BRAND && next <= MAX_BRAND) {
      sizes[i] = next;
      diff -= step;
    }
  }

  return nameList.map((name, i) => {
    const client = CLIENTS[i % CLIENTS.length]!;
    const markets = chance(0.8) ? ['US', ...sample(MARKETS.slice(1), 1 + rand(3))] : sample(MARKETS, 2 + rand(2));
    const studies = sample(STUDY_NAMES, 4).map((s) => `${s}_${pick(['1', '2', '3', '301', '302', '303', '401'])}`);
    const citations: Citation[] = Array.from({ length: 8 }, () => ({
      id: `CIT-${citationSeq++}`,
      ref: `${pick(SURNAMES)} ${String.fromCharCode(65 + rand(26))}, et al. ${pick(JOURNALS)}. ${2018 + rand(8)};${10 + rand(380)}(${1 + rand(12)}):${100 + rand(800)}-${900 + rand(99)}.`,
    }));
    return {
      id: `br_${String(i + 1).padStart(3, '0')}`,
      clientId: client.id,
      name,
      area: pick(AREAS),
      markets: markets.sort((a, b) => MARKETS.indexOf(a) - MARKETS.indexOf(b)),
      size: sizes[i]!,
      studies,
      citations,
    };
  });
}

function gaussian(): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------------------------------------------------------------------------
// Claim texts
// ---------------------------------------------------------------------------

type Role = 'E' | 'C' | 'V' | 'RISK' | 'P' | 'POP' | 'T' | 'D' | 'AE' | 'CONTRA' | 'QOL' | 'TOL' | 'ONSET' | 'FOOD' | 'ADJ' | 'CHEMO';

interface Slot {
  role: Role;
  concept: Concept;
}

interface Draft {
  text: string;
  slots: Slot[];
}

class Ctx {
  slots: Slot[] = [];
  constructor(
    readonly brand: GenBrand,
    readonly endpoint: Endpoint,
    readonly condition: Concept,
  ) {}
  s(role: Role, concept: Concept): string {
    if (!this.slots.some((x) => x.concept === concept)) this.slots.push({ role, concept });
    return pick(concept.clinical);
  }
  get B() {
    return this.brand.name;
  }
  get S() {
    return pick(this.brand.studies);
  }
  get E() {
    return this.s('E', this.endpoint);
  }
  get C() {
    return this.s('C', this.condition);
  }
  get POP() {
    return this.s('POP', pick(POPULATIONS));
  }
  get P() {
    return this.s('P', pick(COMPARATORS));
  }
  get T() {
    return this.s('T', pick(TIMES));
  }
  get D() {
    return this.s('D', pick(DOSING));
  }
}

const n = (lo: number, hi: number) => String(lo + rand(hi - lo + 1));
const UP_MEASURES = new Set(['fev1']);

type Template = (x: Ctx) => string;

const BY_KIND: Record<Endpoint['kind'], Template[]> = {
  event: [
    (x) => `${x.B}® ${x.s('V', GENERIC.reducePast)} the ${x.s('RISK', GENERIC.risk)} of ${x.E} by ${n(8, 55)}% ${x.P} in ${x.POP} with ${x.C} (${x.S}).`,
    (x) => `In ${x.S}, ${x.B} ${x.s('V', GENERIC.reducePast)} ${x.E} by ${n(8, 55)}% ${x.P} ${x.T}.`,
    (x) => `${x.B} is indicated to ${x.s('V', GENERIC.reduceInf)} the ${x.s('RISK', GENERIC.risk)} of ${x.E} in ${x.POP} with ${x.C}.`,
    (x) => `${x.B}® ${x.D}: ${n(8, 55)}% relative ${x.s('RISK', GENERIC.risk)} reduction in ${x.E} ${x.P} (HR 0.${n(55, 92)}; 95% CI 0.${n(40, 54)}-0.${n(93, 99)}; ${x.S}).`,
  ],
  measure: [
    (x) => `${x.B} ${x.s('V', UP_MEASURES.has(x.endpoint.group) ? GENERIC.improvePast : GENERIC.reducePast)} ${x.E} by ${n(5, 60)}% from baseline ${x.T} ${x.P} in ${x.POP} with ${x.C} (${x.S}).`,
    (x) => `${x.B}® ${x.D} ${x.s('V', UP_MEASURES.has(x.endpoint.group) ? GENERIC.improvePast : GENERIC.reducePast)} ${x.E} ${x.T} (p<0.001; ${x.S}).`,
    (x) => `In ${x.POP} with ${x.C}, ${x.B} ${x.s('V', UP_MEASURES.has(x.endpoint.group) ? GENERIC.improvePast : GENERIC.reducePast)} ${x.E} by ${n(1, 9)}.${n(0, 9)} points ${x.P} (${x.S}; p<0.001).`,
  ],
  survival: [
    (x) => {
      const ch = x.s('CHEMO', GENERIC.chemo);
      const m1 = Number(n(9, 30));
      return `${x.B} plus ${ch} ${x.s('V', GENERIC.extendPast)} ${x.E} to ${m1}.${n(0, 9)} months vs ${m1 - 1 - rand(6)}.${n(0, 9)} months with ${ch} alone in ${x.C} (${x.S}).`;
    },
    (x) => `${x.B}® ${x.s('V', GENERIC.improvePast)} ${x.E} ${x.P} in ${x.POP} with ${x.C} (HR 0.${n(55, 85)}; ${x.S}).`,
  ],
  response: [
    (x) => `${n(30, 75)}% of ${x.POP} with ${x.C} ${x.s('V', GENERIC.achieved)} ${x.E} with ${x.B} ${x.T} ${x.P} (${x.S}; p<0.001).`,
    (x) => `More ${x.POP} ${x.s('V', GENERIC.achieved)} ${x.E} on ${x.B} ${x.D} ${x.T} (${n(30, 75)}% vs ${n(5, 29)}%; ${x.S}).`,
  ],
};

const GENERIC_TEMPLATES: Template[] = [
  (x) => {
    const [a, b] = sample(SIDE_EFFECTS, 2);
    return `${x.B} was ${x.s('TOL', GENERIC.wellTolerated)} in ${x.POP} with ${x.C}; the most common ${x.s('AE', GENERIC.adverseEvents)} (≥${n(3, 10)}%) were ${x.s('AE', a!)} and ${x.s('AE', b!)} (${x.S}).`;
  },
  (x) => `Do not use ${x.B} in ${x.POP} with ${x.s('CONTRA', pick(CONTRAINDICATIONS))} or ${x.C}-related complications.`,
  (x) => `${x.B} is contraindicated in ${x.POP} with ${x.s('CONTRA', pick(CONTRAINDICATIONS))}; ${x.s('AE', pick(SIDE_EFFECTS))} was reported in ${n(2, 9)}% of ${x.C} trial participants.`,
  (x) => `${x.B}® offers "${x.D}" dosing ${x.s('FOOD', GENERIC.withFood)} for ${x.POP} with ${x.C}.`,
  (x) => `${x.B} ${x.s('V', GENERIC.improvePast)} patients' ${x.s('QOL', GENERIC.qol)} ${x.T} ${x.P} in ${x.C} (${x.S}).`,
  (x) => `${x.B} provided ${x.s('ONSET', GENERIC.rapid)} ${x.s('ONSET', GENERIC.week1)} in ${x.POP} with ${x.C} (${x.S}).`,
  (x) => `No ${x.s('ADJ', GENERIC.doseAdjust)} of ${x.B} is required for ${x.POP} with ${x.C} and mild ${x.s('CONTRA', pick(CONTRAINDICATIONS.slice(0, 2)))}.`,
  (x) => `${x.B}®: the first "${x.D}" option for ${x.C}.`,
];

const SUFFIXES = [
  'Data from a randomized, double-blind, placebo-controlled phase 3 study.',
  'Individual results may vary.',
  'See full Prescribing Information, including Boxed Warning.',
  'Results were consistent across prespecified subgroups, including age, sex and baseline eGFR.',
  'Secondary endpoint; not adjusted for multiplicity.',
  'Please see Important Safety Information and full Prescribing Information (PI).',
  'Study participants received background standard therapy throughout the trial period.',
  "Based on the investigator's assessment using RECIST v1.1 or equivalent \"best overall response\" criteria.",
];

function draftClaim(brand: GenBrand): Draft {
  for (;;) {
    const endpoint = pick(ENDPOINTS[brand.area]);
    const condition = pick(CONDITIONS[brand.area]);
    const ctx = new Ctx(brand, endpoint, condition);
    const template = chance(0.68) ? pick(BY_KIND[endpoint.kind]) : pick(GENERIC_TEMPLATES);
    let text = template(ctx);
    if (chance(0.3)) text += ' ' + pick(SUFFIXES);
    if (chance(0.08)) text += ' ' + pick(SUFFIXES);
    if (text.length >= 20 && text.length <= 400) return { text, slots: ctx.slots };
  }
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

interface GenClaim extends Claim {
  slots: Slot[];
}

function makeClaims(brands: GenBrand[]): GenClaim[] {
  const out: Omit<GenClaim, 'id'>[] = [];
  for (const brand of brands) {
    const texts = new Set<string>();
    const own: Omit<GenClaim, 'id'>[] = [];
    const twins = Math.round(brand.size * 0.02);
    while (own.length < brand.size - twins) {
      const d = draftClaim(brand);
      if (texts.has(d.text)) continue;
      texts.add(d.text);
      own.push({
        brandId: brand.id,
        clientId: brand.clientId,
        text: d.text,
        status: 'approved',
        markets: sample(brand.markets, 1 + rand(brand.markets.length)).sort((a, b) => MARKETS.indexOf(a) - MARKETS.indexOf(b)),
        channels: sample(CHANNELS, 2 + rand(4)).sort((a, b) => CHANNELS.indexOf(a) - CHANNELS.indexOf(b)),
        expiresAt: '',
        version: 1,
        citations: sample(brand.citations, 1 + rand(3)),
        slots: d.slots,
      });
    }
    // The same wording approved more than once (e.g. under different references).
    for (let i = 0; i < twins; i++) {
      const src = pick(own.slice(0, brand.size - twins));
      own.push({ ...src, markets: [...src.markets], channels: [...src.channels], citations: sample(brand.citations, 1 + rand(3)) });
    }
    out.push(...own);
  }

  shuffle(out);
  return out.map((c, i) => {
    const claim: GenClaim = { id: `clm_${String(i + 1).padStart(6, '0')}`, ...c };
    claim.version = 1 + Math.floor(rng() * rng() * 4);
    const r = rng();
    if (r < 0.04) {
      claim.status = 'revoked';
      claim.version += 1;
      claim.expiresAt = iso(CLOCK_START + (30 + rand(870)) * DAY);
    } else if (r < 0.08) {
      claim.status = 'expired';
      claim.expiresAt = iso(CLOCK_START - (1 + rand(400)) * DAY);
    } else if (r < 0.09) {
      claim.expiresAt = iso(CLOCK_START - (1 + rand(30)) * DAY - rand(DAY));
    } else if (r < 0.11) {
      claim.expiresAt = iso(CLOCK_START + MINUTE + rand(29 * MINUTE));
    } else {
      claim.expiresAt = iso(CLOCK_START + (30 + rand(870)) * DAY + rand(DAY));
    }
    return claim;
  });
}

const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString();

// ---------------------------------------------------------------------------
// Users and assets
// ---------------------------------------------------------------------------

const FIRST = ['Ava', 'Ben', 'Chloe', 'Dev', 'Elena', 'Femi', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kira', 'Liam', 'Maya', 'Nico', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Victor', 'Wen', 'Yusuf'];
const LAST = ['Adler', 'Brooks', 'Castillo', 'Dubois', 'Eze', 'Ferrari', 'Gupta', 'Hughes', 'Ito', 'Jensen', 'Khan', 'Larsen', 'Mensah', 'Nguyen', 'Ortiz', 'Park', 'Quinto', 'Rossi', 'Shah', 'Torres', 'Usman', 'Vega', 'Walsh', 'Young'];
const CAMPAIGNS = ['Q4 launch', 'HCP awareness', 'Congress follow-up', 'Formulary win', 'Patient support', 'New indication', 'Spring refresh', 'Rep leave-behind'];
const CHANNEL_LABEL: Record<string, string> = { email: 'HCP email', banner: 'display banner', web: 'HCP website', print: 'print ad', social: 'social post', rep_detail: 'rep detail aid' };

function makeUsers(): User[] {
  return FIRST.map((first, i) => {
    const primary = CLIENTS[i % CLIENTS.length]!.id;
    const clientIds = i < 16 ? [primary] : [primary, CLIENTS[(i + 1) % CLIENTS.length]!.id];
    return { id: `u_${String(i + 1).padStart(3, '0')}`, name: `${first} ${LAST[i]}`, clientIds };
  });
}

function makeAssets(brands: GenBrand[]): Asset[] {
  const assets: Asset[] = [];
  for (const brand of brands) {
    const combos = new Set<string>();
    while (combos.size < 6) combos.add(`${pick(brand.markets)}|${pick(CHANNELS)}`);
    for (const combo of combos) {
      const [market, channel] = combo.split('|') as [string, string];
      assets.push({
        id: `as_${String(assets.length + 1).padStart(4, '0')}`,
        title: `${brand.name} ${CHANNEL_LABEL[channel]} (${market}) – ${pick(CAMPAIGNS)}`,
        brandId: brand.id,
        clientId: brand.clientId,
        market,
        channel,
      });
    }
  }
  return assets;
}

// ---------------------------------------------------------------------------
// Eval queries
// ---------------------------------------------------------------------------


const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);
const contentWords = (t: string) => new Set(embedderWords(t).filter((w) => !STOPWORDS.has(w)).map(stem));

function makeEvalQueries(claims: GenClaim[], assets: Asset[], users: User[]): EvalQuery[] {
  const byBrand = new Map<string, GenClaim[]>();
  for (const c of claims) {
    const list = byBrand.get(c.brandId) ?? [];
    list.push(c);
    byBrand.set(c.brandId, list);
  }
  const safeUntil = CLOCK_START + 30 * DAY;
  const eligible = (a: Asset) =>
    (byBrand.get(a.brandId) ?? []).filter(
      (c) => c.status === 'approved' && Date.parse(c.expiresAt) > safeUntil && c.markets.includes(a.market) && c.channels.includes(a.channel),
    );

  const kinds: EvalQuery['kind'][] = shuffle([
    ...Array<EvalQuery['kind']>(75).fill('prefix'),
    ...Array<EvalQuery['kind']>(105).fill('fragment'),
    ...Array<EvalQuery['kind']>(120).fill('paraphrase'),
  ]);
  const used = new Set<string>();
  const out: EvalQuery[] = [];

  for (const kind of kinds) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const asset = pick(assets);
      const pool = eligible(asset);
      if (pool.length < 10) continue;
      const target = pick(pool);
      if (used.has(target.id)) continue;
      const query = kind === 'paraphrase' ? paraphrase(target, pool) : fragment(target, pool, kind);
      if (!query) continue;
      const user = pick(users.filter((u) => u.clientIds.includes(asset.clientId)));
      used.add(target.id);
      out.push({ id: `q${String(out.length + 1).padStart(3, '0')}`, query, kind, userId: user.id, assetId: asset.id, targetClaimId: target.id });
      break;
    }
  }
  return out;
}

/** A run of words from the claim as a writer would type it: unique enough to point at the claim. */
function fragment(target: GenClaim, pool: GenClaim[], kind: 'prefix' | 'fragment'): string | null {
  const words = target.text.split(' ');
  if (words.length < 6) return null;
  const others = pool.filter((c) => c.text !== target.text).map((c) => c.text.toLowerCase());
  const starts = words.map((w, i) => i).filter((i) => i > 0 && /^[A-Za-z][a-z-]{3,}$/.test(words[i]!) && !STOPWORDS.has(words[i]!.toLowerCase()));
  if (kind === 'fragment' && starts.length === 0) return null;
  const start = kind === 'prefix' ? 0 : pick(starts);
  for (let len = 3 + rand(2); start + len <= words.length && len <= 8; len++) {
    let q = words.slice(start, start + len).join(' ');
    const last = words[start + len - 1]!;
    if (chance(0.5) && last.length > 4) q = q.slice(0, q.length - last.length + 2 + rand(last.length - 3));
    if (kind === 'fragment' && chance(0.5)) q = q.toLowerCase();
    q = q.replace(/[.,;:]$/, '');
    if (q.length > 80 || q.length < 8) continue;
    const lower = q.toLowerCase();
    if (others.filter((t) => t.includes(lower)).length <= 1) return q;
  }
  return null;
}

const PRIMARY: Role[] = ['E', 'C', 'AE', 'CONTRA', 'QOL', 'ONSET', 'D', 'TOL', 'FOOD', 'ADJ', 'CHEMO'];
const SECONDARY: Role[] = ['V', 'RISK', 'P', 'T', 'POP'];
const ORDER: Role[] = ['V', 'TOL', 'ONSET', 'ADJ', 'D', 'E', 'RISK', 'QOL', 'AE', 'CHEMO', 'FOOD', 'C', 'POP', 'CONTRA', 'P', 'T'];
const LEAD: Partial<Record<Role, string[]>> = { C: ['for ', 'in '], POP: ['in ', 'for '], CONTRA: ['not for ', 'avoid in '], ADJ: ['no '] };

/** The same idea in everyday words, sharing no content words with the claim. */
function paraphrase(target: GenClaim, pool: GenClaim[]): string | null {
  const targetWords = contentWords(target.text);
  const vectors = pool.map((c) => vectorFor(c.text));
  for (let attempt = 0; attempt < 8; attempt++) {
    const primary = shuffle(target.slots.filter((s) => PRIMARY.includes(s.role))).slice(0, 3);
    const secondary = shuffle(target.slots.filter((s) => SECONDARY.includes(s.role))).slice(0, 1 + rand(2));
    const chosen = [...primary, ...secondary].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
    if (chosen.length < 3) return null;
    const parts: string[] = [];
    let prevAE = false;
    for (const s of chosen) {
      const lay = pick(s.concept.lay);
      const lead = LEAD[s.role] ? pick(LEAD[s.role]!) : '';
      parts.push(s.role === 'AE' && prevAE ? `and ${lay}` : lead + lay);
      prevAE = s.role === 'AE';
    }
    const q = parts.join(' ');
    if (q.length > 120) continue;
    const qWords = contentWords(q);
    if ([...qWords].some((w) => targetWords.has(w))) continue;
    // Keep only paraphrases that still point at the claim among what the writer may use.
    const qv = vectorFor(q);
    const mine = cosine(qv, vectorFor(target.text));
    let better = 0;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i]!.text !== target.text && cosine(qv, vectors[i]!) > mine) better++;
    }
    if (better <= 2) return q;
  }
  return null;
}

// ---------------------------------------------------------------------------

let generated = false;

/** Writes the data files. With `ifMissing`, does nothing when they all exist. */
export function generateData({ ifMissing = false } = {}): void {
  if (generated) throw new Error('generateData() can only run once per process');
  if (ifMissing && Object.values(DATA_FILES).every((f) => existsSync(f))) return;

  generated = true;
  const started = Date.now();
  const brands = makeBrands();
  const claims = makeClaims(brands);
  const users = makeUsers();
  const assets = makeAssets(brands);
  const evalQueries = makeEvalQueries(claims, assets, users);

  const publicClaims: Claim[] = claims.map(({ slots: _slots, ...c }) => c);
  writeFileSync(DATA_FILES.claims, '[\n' + publicClaims.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
  writeFileSync(
    DATA_FILES.entitlements,
    JSON.stringify(
      {
        clients: CLIENTS,
        brands: brands.map(({ id, clientId, name }) => ({ id, clientId, name })),
        users,
        assets,
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(DATA_FILES.evalQueries, JSON.stringify(evalQueries, null, 2) + '\n');
  console.log(
    `data: ${claims.length} claims, ${brands.length} brands, ${assets.length} assets, ${users.length} users, ` +
      `${evalQueries.length} eval queries (${Date.now() - started} ms)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateData({ ifMissing: process.argv.includes('--if-missing') });
}
