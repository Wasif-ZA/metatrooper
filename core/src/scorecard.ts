export interface RunRecord { engine: string; repo: string; at: string; checksPassed: boolean; repairTries: number; undone: boolean; usd: number | null }
export const MIN_RUNS = 5;
export const RECENT_RUNS = 5;
export const WORSE_DROP = 0.2;
export interface ScoreRow { engine: string; repo: string; runs: number; passRate: number; repairTriesPerRun: number; undoRate: number; usdPerRun: number | null; pricedRuns: number; enough: boolean; rank: number | null; worse: boolean; recentPassRate: number | null; earlierPassRate: number | null }
export interface RepoCard { repo: string; rows: ScoreRow[]; note: string | null }

const EPS = 1e-9;
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const passShare = (rs: RunRecord[]): number => rs.filter((r) => r.checksPassed === true).length / rs.length;

/** Builds one score row from a single engine's records in one repo. */
function rowFor(engine: string, repo: string, records: RunRecord[]): ScoreRow {
  const runs = records.length;
  const priced = records.filter((r) => typeof r.usd === 'number' && Number.isFinite(r.usd) && r.usd >= 0);
  const sorted = [...records].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const recent = sorted.slice(-RECENT_RUNS);
  const earlier = sorted.slice(0, sorted.length - recent.length);
  const trend = recent.length === RECENT_RUNS && earlier.length >= MIN_RUNS;
  const recentPassRate = trend ? passShare(recent) : null;
  const earlierPassRate = trend ? passShare(earlier) : null;
  return {
    engine,
    repo,
    runs,
    passRate: passShare(records),
    repairTriesPerRun: records.reduce((s, r) => s + (Number.isFinite(r.repairTries) && r.repairTries > 0 ? r.repairTries : 0), 0) / runs,
    undoRate: records.filter((r) => r.undone === true).length / runs,
    usdPerRun: priced.length ? priced.reduce((s, r) => s + (r.usd as number), 0) / priced.length : null,
    pricedRuns: priced.length,
    enough: runs >= MIN_RUNS,
    rank: null,
    worse: recentPassRate !== null && earlierPassRate !== null && earlierPassRate - recentPassRate >= WORSE_DROP - EPS,
    recentPassRate,
    earlierPassRate,
  };
}

/** Groups run records by repo and engine and ranks engines within each repo. */
export function scorecard(records: RunRecord[]): RepoCard[] {
  const repos = new Map<string, Map<string, RunRecord[]>>();
  for (const r of records) {
    if (!r || typeof r.engine !== 'string' || !r.engine || typeof r.repo !== 'string' || !r.repo) continue;
    if (Number.isNaN(Date.parse(r.at))) continue;
    const engines = repos.get(r.repo) ?? new Map<string, RunRecord[]>();
    engines.set(r.engine, [...(engines.get(r.engine) ?? []), r]);
    repos.set(r.repo, engines);
  }
  return [...repos.keys()].sort(byName).map((repo) => {
    const rows = [...repos.get(repo)!].map(([engine, rs]) => rowFor(engine, repo, rs));
    const ranked = rows
      .filter((r) => r.enough)
      .sort((a, b) => b.passRate - a.passRate || (a.usdPerRun ?? Infinity) - (b.usdPerRun ?? Infinity) || byName(a.engine, b.engine));
    ranked.forEach((r, i) => { r.rank = i + 1; });
    const rest = rows.filter((r) => !r.enough).sort((a, b) => byName(a.engine, b.engine));
    return { repo, rows: [...ranked, ...rest], note: ranked.length ? null : 'not enough runs' };
  });
}
