/**
 * The statistics behind the piece, with no dependencies: rounding, means and medians, a least-squares line, least
 * squares with errors clustered by state (CR1, t with G-1 degrees of freedom), and R² by Gram-Schmidt that drops a
 * column the earlier ones already span (as the analysis's fits do). Also a small CSV reader.
 */

/** Round half away from zero to `dp` decimals (the pool's rounding rule: once, from the unrounded value). */
export function round(v: number, dp = 1): number {
  const k = 10 ** dp;
  const r = Math.round(Math.abs(v) * k + 1e-9) / k;
  return v < 0 ? -r : r;
}

/** Median of a list (mean of the two middle values for an even count). */
export function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) return Number.NaN;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

/** Least-squares line of `ys` on `xs`. */
export function fitLine(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Mean of a list. */
export function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The inverse of a square matrix (Gauss-Jordan with partial pivoting). */
function inverse(a: readonly number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('inverse: singular matrix');
    m[c] = m[c].map((v) => v / d);
    for (let r = 0; r < n; r++) {
      if (r === c || !m[r][c]) continue;
      const f = m[r][c];
      m[r] = m[r].map((v, j) => v - f * m[c][j]);
    }
  }
  return m.map((row) => row.slice(n));
}

/** The upper quantile of Student's t: the t with probability `p` above it, for `df` degrees of freedom. */
export function tQuantile(p: number, df: number): number {
  // The t distribution's upper tail through the regularized incomplete beta (Lentz's continued fraction).
  const lgamma = (x: number): number => {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x;
    const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
    let s = 1.000000000190015;
    for (const c of g) s += c / ++y;
    return -t + Math.log((2.5066282746310005 * s) / x);
  };
  const betacf = (a: number, b: number, x: number): number => {
    let c = 1;
    let d = 1 - ((a + b) * x) / (a + 1);
    d = 1 / d;
    let h = d;
    for (let m = 1; m < 300; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
      d = 1 / (1 + aa * d);
      c = 1 + aa / c;
      h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
      d = 1 / (1 + aa * d);
      c = 1 + aa / c;
      h *= d * c;
    }
    return h;
  };
  const upper = (t: number): number => {
    const x = df / (df + t * t);
    const a = df / 2;
    const bt = Math.exp(lgamma(a + 0.5) - lgamma(a) - lgamma(0.5) + a * Math.log(x) + 0.5 * Math.log(1 - x));
    return (0.5 * bt * betacf(a, 0.5, x)) / a;
  };
  let lo = 0;
  let hi = 50;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (upper(mid) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A least-squares fit with errors clustered by group, as the analysis computes them. */
export interface ClusteredFit {
  /** Column names kept (all-zero columns are dropped). */
  names: string[];
  b: number[];
  /** Covariance of `b`, clustered, with the CR1 correction G/(G−1) × (n−1)/(n−k). */
  V: number[][];
  /** Number of clusters; the t for intervals has G−1 degrees of freedom. */
  G: number;
}

/** Least squares of `y` on the columns of `X` (include a column of ones for an intercept), clustered by `groups`. */
export function olsClustered(X: readonly number[][], y: readonly number[], names: readonly string[], groups: readonly string[]): ClusteredFit {
  const keep = names.map((_, j) => j).filter((j) => X.some((row) => row[j] !== 0));
  const Xk = X.map((row) => keep.map((j) => row[j]));
  const k = keep.length;
  const n = Xk.length;
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Xk.reduce((s, r) => s + r[i] * r[j], 0)));
  const A = inverse(xtx);
  const xty = Array.from({ length: k }, (_, i) => Xk.reduce((s, r, t) => s + r[i] * y[t], 0));
  const b = A.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const u = Xk.map((r, t) => y[t] - r.reduce((s, v, j) => s + v * b[j], 0));
  const byGroup = new Map<string, number[]>();
  groups.forEach((g, t) => byGroup.set(g, [...(byGroup.get(g) ?? []), t]));
  const M = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const ids of byGroup.values()) {
    const s = Array.from({ length: k }, (_, a) => ids.reduce((acc, t) => acc + Xk[t][a] * u[t], 0));
    for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) M[a][c] += s[a] * s[c];
  }
  const G = byGroup.size;
  const cf = (G / (G - 1)) * ((n - 1) / (n - k));
  const AM = A.map((row) => Array.from({ length: k }, (_, c) => row.reduce((s, v, t) => s + v * M[t][c], 0)));
  const V = AM.map((row) => Array.from({ length: k }, (_, c) => cf * row.reduce((s, v, t) => s + v * A[t][c], 0)));
  return { names: keep.map((j) => names[j]), b, V, G };
}

/** The difference between two coefficients of a fit, with its 95 percent interval. */
export function contrast(f: ClusteredFit, a: string, c: string): { est: number; se: number; lo: number; hi: number } {
  const i = f.names.indexOf(a);
  const j = f.names.indexOf(c);
  if (i < 0 || j < 0) throw new Error(`contrast: ${i < 0 ? a : c} is not in the fit`);
  const est = f.b[i] - f.b[j];
  const se = Math.sqrt(f.V[i][i] + f.V[j][j] - 2 * f.V[i][j]);
  const t = tQuantile(0.025, f.G - 1);
  return { est, se, lo: est - t * se, hi: est + t * se };
}

/**
 * R² of least squares of `y` on the columns of `X` (include a column of ones for an intercept). Columns are added in
 * order by modified Gram-Schmidt, and a column the earlier ones already span is skipped, as the analysis's own fits drop
 * collinear terms. Returns the share explained, the columns kept and the residuals.
 */
export function rSquared(X: readonly number[][], y: readonly number[]): { r2: number; kept: number; resid: number[] } {
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const Q: number[][] = [];
  for (let j = 0; j < X[0].length; j++) {
    let v = X.map((row) => row[j]);
    const norm0 = Math.sqrt(dot(v, v));
    if (norm0 === 0) continue;
    for (let pass = 0; pass < 2; pass++)
      for (const q of Q) {
        const d = dot(q, v);
        v = v.map((x, i) => x - d * q[i]);
      }
    const norm = Math.sqrt(dot(v, v));
    if (norm / norm0 < 1e-8) continue;
    Q.push(v.map((x) => x / norm));
  }
  let resid = [...y];
  for (const q of Q) {
    const d = dot(q, resid);
    resid = resid.map((x, i) => x - d * q[i]);
  }
  const my = mean(y);
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  return { r2: 1 - dot(resid, resid) / sst, kept: Q.length, resid };
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF) to rows of objects keyed by the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

