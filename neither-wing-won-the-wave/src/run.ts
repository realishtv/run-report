/**
 * Every number "Neither wing won the wave" prints (election.run/report/neither-wing-won-the-wave), rebuilt from
 * data/analysis_table.csv and data/maine.csv.
 *
 *   bun src/run.ts           print them and write numbers.json
 *   bun src/run.ts --check   also compare with article.json, the numbers the article printed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, fitLine, mean, olsClustered, parseCsv, round } from './stats';

type Row = Record<string, string>;
const DIR = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const rows: Row[] = parseCsv(read('data/analysis_table.csv'));
const num = (r: Row, k: string) => (r[k] === '' || r[k] === undefined || r[k] === 'NA' ? 0 : Number(r[k]));
const must = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`check failed: ${what}`);
};
const out: Record<string, number | string> = {};

// ─── Context ──────────────────────────────────────────────────────────────────────────────────────────────────
// A race's score (y_central) is the Democrat's 2026 two-party margin on our projection of the final count, minus
// Harris's 2024 margin in the district (b), minus the national shift. Every row carries the same shift.
const shifts = rows.map((r) => num(r, 'margin_central') - num(r, 'b') - num(r, 'y_central'));
const shift = mean(shifts);
must(shifts.every((s) => Math.abs(s - shift) < 0.001), 'one national shift');
out['ctx.shift'] = round(shift, 1);
// civicAPI's pull of 2026-11-08T18:37:19Z, except where a later AP or state count replaced it.
out['ctx.counts_as_of'] = '1:37 PM Eastern on Nov 8';
out['ctx.later_counts_districts'] = rows.filter((r) => r.count_source !== 'civicAPI').length;

// ─── The test: sitting House Democrats, by caucus ─────────────────────────────────────────────────────────────
// Progressives: Progressive Caucus members who are not New Democrats. Centrists: New Democrats outside the
// Progressive Caucus, and every Blue Dog. Members of both the Progressive Caucus and the New Democrats are their own
// group. The caucus figures keep two decimals, the fewest at which the averages add up on the page.
const sitting = rows.filter((r) => r.inc_D === '1');
const isP = (r: Row) => r.cpc_only === '1';
const isC = (r: Row) => r.nd_only === '1' || (r.blue_dog === '1' && r.cpc_only !== '1' && r.cpc_nd_both !== '1');
const P = sitting.filter(isP);
const C = sitting.filter(isC);
const avg = (rs: Row[], k: string, sign = 1) => mean(rs.map((r) => sign * num(r, k)));
out['caucus.n.cpc_only'] = P.length;
out['caucus.n.centrist'] = C.length;
out['caucus.n.both'] = sitting.filter((r) => r.cpc_nd_both === '1').length;
out['caucus.avg_ran.cpc_only'] = round(avg(P, 'y_central'), 2);
out['caucus.avg_ran.centrist'] = round(avg(C, 'y_central'), 2);
out['caucus.avg_gap'] = round(avg(P, 'y_central') - avg(C, 'y_central'), 2);
must(round(round(avg(C, 'y_central'), 2) - round(avg(P, 'y_central'), 2), 2) === -Number(out['caucus.avg_gap']), 'the averages add up to the gap');
out['seat.avg.cpc_only'] = round(avg(P, 'b'), 2);
out['seat.avg.centrist'] = round(avg(C, 'b'), 2);

// The seat line: score on 2024 margin, least squares over every sitting Democrat, read at each camp's average seat.
const line = fitLine(sitting.map((r) => num(r, 'b')), sitting.map((r) => num(r, 'y_central')));
out['seat.usual.centrist'] = round(line.intercept + line.slope * avg(C, 'b'), 2);
out['seat.usual.cpc_only'] = round(line.intercept + line.slope * avg(P, 'b'), 2);

// Similar seats: each party's sitting members, the caucus groups as dummies, and controls for the 2024 margin and its
// square, redrawn lines, the share of the vote still out, night-only counts, how the state's other races went, the
// member's own 2024 run against the ticket, and the opponent's prior office. Errors clustered by state.
function similarSeats(party: 'D' | 'R', groups: string[], extra: string[] = []) {
  const sign = party === 'D' ? 1 : -1;
  const own = party === 'D' ? ['pv_D', 'pvmiss_D', 'rpo_higher', 'rpo_sl', 'rpo_local'] : ['pv_R', 'pvmiss_R', 'dpo_higher', 'dpo_sl', 'dpo_local'];
  const ctrl = ['b', 'b2', 'redrawn', 'out_pct', 'night', 'ctx', 'ctx_alone', ...own, ...extra];
  const rs = rows.filter((r) => r[`inc_${party}`] === '1');
  const val = (r: Row, k: string) => (k === 'cent' ? (isC(r) ? 1 : 0) : k === 'b2' ? num(r, 'b') ** 2 / 100 : k === 'ctx' ? sign * num(r, 'ctx_y_central') : num(r, k));
  const X = rs.map((r) => [1, ...groups.map((g) => val(r, g)), ...ctrl.map((k) => val(r, k))]);
  const y = rs.map((r) => sign * num(r, 'y_central'));
  return olsClustered(X, y, ['(intercept)', ...groups, ...ctrl], rs.map((r) => r.state));
}
const dem = contrast(similarSeats('D', ['cpc_only', 'cent', 'cpc_nd_both']), 'cpc_only', 'cent');
out['caucus.similar_gap'] = round(dem.est, 2);
out['caucus.similar_gap.lo'] = round(dem.lo, 2);
out['caucus.similar_gap.hi'] = round(dem.hi, 2);
const hisp = contrast(similarSeats('D', ['cpc_only', 'cent', 'cpc_nd_both'], ['hisp', 'hisp_miss']), 'cpc_only', 'cent');
out['caucus.similar_gap.hisp'] = round(hisp.est, 2);
out['caucus.similar_gap.hisp.lo'] = round(hisp.lo, 2);
out['caucus.similar_gap.hisp.hi'] = round(hisp.hi, 2);

// Republicans, scored Republican-positive: Freedom Caucus against Main Street, the Governance Group its own term.
const gop = rows.filter((r) => r.inc_R === '1');
out['gop.avg_gap'] = round(avg(gop.filter((r) => r.freedom === '1'), 'y_central', -1) - avg(gop.filter((r) => r.main_street === '1'), 'y_central', -1), 2);
out['gop.similar_gap'] = round(contrast(similarSeats('R', ['freedom', 'main_street', 'rgg']), 'freedom', 'main_street').est, 2);

// ─── The read: what explains the differences between races ────────────────────────────────────────────────────
// One least-squares model of the score over 275 races (the ranking pool, S_main), its terms in nine blocks. Each
// block's share is its Shapley value: its average gain in R² over every order of adding the blocks (all 512 subsets).
const BLOCKS: [string, string[]][] = [
  ['seat', ['b', 'b2', 'redrawn']],
  ['count', ['out_pct', 'night']],
  ['state context', ['ctx', 'ctx_alone']],
  ['composition', ['swing', 'swing_miss', 'hisp', 'hisp_miss']],
  ['incumbency', ['inc_D', 'inc_R', 'pv_D', 'pv_R', 'pvmiss_D', 'pvmiss_R']],
  ['prior office', ['dpo_higher', 'dpo_sl', 'dpo_local', 'rpo_higher', 'rpo_sl', 'rpo_local']],
  ['money', ['mshare', 'dmoney_miss', 'rmoney_miss', 'ie_share']],
  ['small-dollar', ['dunit', 'dunit_miss', 'runit', 'runit_miss']],
  ['ideology', ['dnom', 'rnom', 'd_prog_only', 'd_cent_only', 'd_both', 'r_hard', 'r_main']],
];
const IDEO = BLOCKS.length - 1;
const S = rows.filter((r) => r.in_s_main === '1');
must(S.length === 275, `${S.length} races in the model`);
const n = S.length;
const column = (k: string, outcome: 'central' | 'now', src: Row[] = S) =>
  Float64Array.from(src, (r) => (k === 'b2' ? num(r, 'b') ** 2 / 100 : k === 'ctx' ? num(r, `ctx_y_${outcome}`) : num(r, k)));

/** R² of y on an intercept and `cols` in order (Gram-Schmidt, skipping a column the earlier ones span), and which columns it kept. */
function fit(cols: Float64Array[], y: Float64Array): { r2: number; kept: boolean[] } {
  const Q: Float64Array[] = [Float64Array.from(y, () => 1 / Math.sqrt(y.length))];
  const kept: boolean[] = [];
  for (const c of cols) {
    const v = Float64Array.from(c);
    const n0 = Math.hypot(...v);
    if (n0 === 0) {
      kept.push(false);
      continue;
    }
    for (let pass = 0; pass < 2; pass++)
      for (const q of Q) {
        let d = 0;
        for (let i = 0; i < v.length; i++) d += q[i] * v[i];
        for (let i = 0; i < v.length; i++) v[i] -= d * q[i];
      }
    const nv = Math.hypot(...v);
    if (nv / n0 < 1e-8) {
      kept.push(false);
      continue;
    }
    for (let i = 0; i < v.length; i++) v[i] /= nv;
    Q.push(v);
    kept.push(true);
  }
  const r = Float64Array.from(y);
  for (const q of Q) {
    let d = 0;
    for (let i = 0; i < r.length; i++) d += q[i] * r[i];
    for (let i = 0; i < r.length; i++) r[i] -= d * q[i];
  }
  const my = mean([...y]);
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < y.length; i++) {
    sse += r[i] ** 2;
    sst += (y[i] - my) ** 2;
  }
  return { r2: 1 - sse / sst, kept };
}

const m = BLOCKS.length;
const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
const weight = (s: number) => (fact(s) * fact(m - s - 1)) / fact(m);
const size = (mask: number) => [...mask.toString(2)].filter((b) => b === '1').length;

/** R² and kept-column count for every subset of blocks, with `cols[b]` each block's columns. */
function subsets(cols: Float64Array[][], y: Float64Array, only?: number) {
  const r2 = new Float64Array(1 << m);
  const kept = new Int32Array(1 << m);
  for (let mask = 1; mask < 1 << m; mask++) {
    if (only !== undefined && !(mask & (1 << only))) continue;
    const f = fit(BLOCKS.flatMap((_, b) => (mask & (1 << b) ? cols[b] : [])), y);
    r2[mask] = f.r2;
    kept[mask] = 1 + f.kept.filter(Boolean).length;
  }
  kept[0] = 1;
  return { r2, kept };
}
const shapley = (r2: Float64Array, b: number) => {
  let v = 0;
  for (let mask = 0; mask < 1 << m; mask++) if (!(mask & (1 << b))) v += weight(size(mask)) * (r2[mask | (1 << b)] - r2[mask]);
  return v;
};

const y = Float64Array.from(S, (r) => num(r, 'y_central'));
const cols = BLOCKS.map(([, ks]) => ks.map((k) => column(k, 'central')));
const all = subsets(cols, y);
const full = all.r2[(1 << m) - 1];
const share = BLOCKS.map((_, b) => shapley(all.r2, b));
must(Math.abs(share.reduce((a, v) => a + v, 0) - full) < 1e-9, 'the shares add up to R²');
const pct = (v: number) => round(v * 100, 1);
const by = (name: string) => share[BLOCKS.findIndex(([b]) => b === name)];
out['explain.place'] = pct(by('seat') + by('state context') + by('composition'));
out['explain.incumbency'] = pct(by('incumbency'));
out['explain.other'] = pct(by('count') + by('prior office') + by('money') + by('small-dollar'));
out['explain.ideology'] = pct(by('ideology'));
out['explain.unexplained'] = pct(1 - full);

// Random numbers: what as many columns of pure noise as the ideology block keeps would get in its place. Adding q
// noise columns to a fit with p columns (intercept included) raises R² by (1 − R²) q / (n − p) in expectation, so the
// expected Shapley value is that, averaged with the same weights. Exact, no draws.
const fullFit = fit(cols.flat(), y);
let offset = 0;
const keptIdeo = BLOCKS.map(([, ks]) => {
  const k = fullFit.kept.slice(offset, offset + ks.length).filter(Boolean).length;
  offset += ks.length;
  return k;
})[IDEO];
let noise = 0;
for (let mask = 0; mask < 1 << m; mask++) if (!(mask & (1 << IDEO))) noise += weight(size(mask)) * ((1 - all.r2[mask]) * keptIdeo) / (n - all.kept[mask]);
out['explain.noise'] = pct(noise);

// The same model on the votes counted so far: a similar share is left unexplained.
const yNow = Float64Array.from(S, (r) => num(r, 'y_now'));
const now = fit(BLOCKS.flatMap(([, ks]) => ks.map((k) => column(k, 'now'))), yNow);
must(Math.abs(now.r2 - full) < 0.02, `on the current count the model leaves ${pct(1 - now.r2)} percent unexplained`);
out['explain.unexplained.now'] = pct(1 - now.r2);

// The shuffle check: the real ideology measures, shuffled 200 times among like candidates (sitting Democrats' voting
// records among sitting Democrats, newcomers' endorsement labels among newcomers, the same for Republicans).
let seed = 20261103;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = <T>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const SHUFFLES = 200;
const GROUPS: [(r: Row) => boolean, string[]][] = [
  [(r) => r.inc_D === '1', ['dnom']],
  [(r) => r.inc_R === '1', ['rnom']],
  [(r) => r.inc_D !== '1', ['d_prog_only', 'd_cent_only', 'd_both']],
  [(r) => r.inc_R !== '1', ['r_hard', 'r_main']],
];
const ideoNames = BLOCKS[IDEO][1];
const shuffled: number[] = [];
for (let k = 0; k < SHUFFLES; k++) {
  const vals = Object.fromEntries(ideoNames.map((nm) => [nm, S.map((r) => num(r, nm))]));
  for (const [inGroup, names] of GROUPS) {
    const idx = S.flatMap((r, i) => (inGroup(r) ? [i] : []));
    const perm = shuffle([...idx]);
    for (const nm of names) {
      const src = perm.map((i) => num(S[i], nm));
      idx.forEach((i, t) => (vals[nm][i] = src[t]));
    }
  }
  const c2 = [...cols.slice(0, IDEO), ideoNames.map((nm) => Float64Array.from(vals[nm]))];
  const sh = subsets(c2, y, IDEO);
  for (let mask = 0; mask < 1 << m; mask++) if (!(mask & (1 << IDEO))) sh.r2[mask] = all.r2[mask];
  shuffled.push(shapley(sh.r2, IDEO));
}
out['explain.shuffled'] = pct(mean(shuffled));
out['explain.shuffled.at_or_above'] = round(shuffled.filter((v) => v >= by('ideology')).length / SHUFFLES, 3);
must(Number(out['explain.shuffled.at_or_above']) > 0.5, 'more than half the shuffles do at least as well as the real measures');

// ─── Maine ────────────────────────────────────────────────────────────────────────────────────────────────────
// Collins against the wave: Harris's 2024 two-party margin in Maine (the two districts summed) plus the national
// shift, against the Senate race's first-round two-party margin on the same count.
const me = parseCsv(read('data/maine.csv'));
const votes = (race: (r: Row) => boolean, party: string) => me.filter((r) => race(r) && r.party === party).reduce((a, r) => a + Number(r.votes), 0);
const margin = (d: number, r: number) => (100 * (d - r)) / (d + r);
const sen = (r: Row) => r.race === 'ME-SEN';
const house = (r: Row) => r.race !== 'ME-SEN';
const jackson = margin(votes(sen, 'Democratic'), votes(sen, 'Republican'));
const harris = margin(votes(house, 'Harris 2024'), votes(house, 'Trump 2024'));
out['maine.collins_vs_wave'] = round(harris + shift - jackson, 1);
// The same-ballot comparison: Collins against her party's two House candidates.
out['maine.collins_vs_house'] = round(margin(votes(house, 'Democratic'), votes(house, 'Republican')) - jackson, 1);

// ─── Output ───────────────────────────────────────────────────────────────────────────────────────────────────
writeFileSync(join(DIR, 'numbers.json'), `${JSON.stringify(out, null, 2)}\n`);
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(32)} ${v}`);
if (process.argv.includes('--check')) {
  const article = JSON.parse(read('article.json')) as Record<string, number | string>;
  const off = Object.entries(article).filter(([k, v]) => String(out[k]) !== String(v));
  for (const [k, v] of off) console.log(`differs  ${k}: the article printed ${v}, this gives ${out[k]}`);
  if (off.length) process.exit(1);
  console.log(`\nAll ${Object.keys(article).length} of the article's numbers match.`);
}
