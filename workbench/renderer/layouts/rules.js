// Picks the layout a pipeline run is shown on, and decides when an automatic pick may move the screen.
(function (root) {
  const LIBRARY = ['run-log', 'artifact-columns', 'pr-first', 'pipe', 'agent-split'];
  const REVIEW = ['pr-inline', 'duel', 'buckets', 'coverage-map', 'triage'];
  const loopMoment = (list = []) => {
    const st = (id) => (list.find((s) => s.id === id) || {}).status;
    return st('approve-spec') === 'waiting' ? 'spec' : st('handback') === 'done' ? 'handback' : '';
  };
  const status = (list, id) => (list.find((s) => s.id === id) || {}).status;
  const siteMoment = (list = [], run = {}) => (run.paused_why === 'loop-max' ? 'gaveup' : status(list, 'approve') === 'waiting' ? 'approve' : '');
  const variantsMoment = (list = []) => (status(list, 'approve-directions') === 'waiting' ? 'directions' : status(list, 'pick') === 'waiting' ? 'pick' : '');
  const qaMoment = (list = [], run = {}, data = null) => (data && data.critical ? 'critical' : status(list, 'report') === 'done' && data && data.open ? 'open' : '');
  const gaveUp = (run = {}) => run.paused_why === 'loop-max';
  const flagged = (data) => Boolean(data && data.flag);
  /** Returns the first waiting gate among ids, or ''. */
  const waitingAt = (list = [], ...ids) => ids.find((id) => status(list, id) === 'waiting') || '';
  /** A pipeline whose rule is a first-match list of [moment, layout]; moment(list, run, data) names where the run is. */
  const firstMatch = (five, momentOf, layouts, extra = {}) => ({
    five,
    onFail: 'run-log',
    pick: (run, list, data) => layouts[momentOf(list, run, data)] || null,
    opens: (data, list, run) => Boolean(momentOf(list, run, data)),
    moment: momentOf,
    ...extra,
  });
  const RULES = {
    'spec-to-pr': { five: LIBRARY, onFail: 'run-log', pick: () => null },
    'two-engine-review': {
      five: REVIEW,
      onFail: 'run-log',
      pick: (run, list, data) => (!data ? null : data.disagree ? 'duel' : data.critical ? 'triage' : data.files >= 3 ? 'buckets' : 'pr-inline'),
      opens: (data) => Boolean(data && (data.disagree || data.critical)),
    },
    'spec-build-review-handback': {
      five: ['hand-back', 'artifact-columns', 'agent-split', 'agent-split', 'run-log'],
      onFail: 'run-log',
      pick: (run, list) => ({ spec: 'artifact-columns', handback: 'hand-back' }[loopMoment(list)] || (list.some((s) => s.status === 'running') ? 'agent-split' : null)),
      opens: (data, list) => Boolean(loopMoment(list)),
      moment: loopMoment,
    },
    'website-build': {
      five: ['preview-stage', 'before-after', 'pipe', 'agent-split', 'run-log'],
      onFail: 'run-log',
      pick: (run, list) => {
        const m = siteMoment(list, run);
        if (m) return m === 'gaveup' ? 'before-after' : 'preview-stage';
        if (status(list, 'production') === 'done') return 'pipe';
        if (status(list, 'build') === 'running') return 'agent-split';
        if (status(list, 'critique') === 'running') return 'before-after';
        return 'pipe';
      },
      opens: (data, list, run) => Boolean(siteMoment(list, run)),
      moment: siteMoment,
    },
    'design-variants': {
      five: ['variants-grid', 'artifact-columns', 'preview-stage', 'agent-split', 'artifact-columns'],
      onFail: 'agent-split',
      pick: (run, list) => {
        const m = variantsMoment(list);
        if (m) return m === 'directions' ? 'artifact-columns' : 'variants-grid';
        if (status(list, 'polish') === 'running' || status(list, 'polish') === 'done') return 'preview-stage';
        if (status(list, 'variants') === 'running') return 'variants-grid';
        return 'artifact-columns';
      },
      opens: (data, list) => Boolean(variantsMoment(list)),
      moment: variantsMoment,
    },
    'e2e-browser-qa': {
      five: ['timeline', 'run-log', 'coverage-map', 'before-after', 'timeline'],
      onFail: 'run-log',
      pick: (run, list, data) => {
        if (!data) return null;
        if (data.critical) return 'timeline';
        if (data.open && data.files >= 3) return 'coverage-map';
        if (data.open && data.fixed) return 'before-after';
        return data.open ? 'timeline' : 'before-after';
      },
      opens: (data, list, run) => Boolean(qaMoment(list, run, data)),
      moment: qaMoment,
    },
    'docs-and-release-notes': firstMatch(
      ['pr-first', 'run-log', 'before-after', 'preview-stage', 'artifact-columns'],
      (list, run, data) => (data && data.breaking_no_doc ? 'breaking' : waitingAt(list, 'approve') ? 'approve' : status(list, 'release') === 'done' ? 'released' : ''),
      { breaking: 'pr-first', approve: 'pr-first', released: 'artifact-columns' },
      { opens: (data, list) => Boolean((data && data.breaking_no_doc) || waitingAt(list, 'approve')) },
    ),
    'security-review-and-upgrade': firstMatch(
      ['pr-first', 'triage', 'triage', 'before-after', 'run-log'],
      (list, run, data) => (gaveUp(run) ? 'gaveup' : data && data.licence_conflict ? 'licence' : data && data.high_reachable ? 'reachable' : waitingAt(list, 'approve-upgrade') ? 'approve' : ''),
      { gaveup: 'run-log', licence: 'triage', reachable: 'triage', approve: 'pr-first' },
    ),
    'footage-to-edit': firstMatch(
      ['timeline', 'preview-stage', 'before-after', 'pipe', 'run-log'],
      (list, run, data) => waitingAt(list, 'approve-plan', 'approve-final') || (flagged(data) && status(list, 'approve-final') !== 'done' ? 'flag' : ''),
      { 'approve-plan': 'timeline', 'approve-final': 'preview-stage', flag: 'before-after' },
    ),
    'clips-to-scheduled-posts': firstMatch(
      ['variants-grid', 'preview-stage', 'timeline', 'pr-first', 'run-log'],
      (list, run, data) => (waitingAt(list, 'pick') ? 'pick' : waitingAt(list, 'approve') ? (flagged(data) ? 'flag' : 'approve') : ''),
      { pick: 'variants-grid', flag: 'preview-stage', approve: 'pr-first' },
    ),
    'seo-audit-fix': firstMatch(
      ['triage', 'coverage-map', 'before-after', 'pr-first', 'run-log'],
      (list, run) => (gaveUp(run) ? 'gaveup' : waitingAt(list, 'approve') ? 'approve' : ''),
      { gaveup: 'before-after', approve: 'pr-first' },
    ),
    'deep-research-cited': firstMatch(
      ['artifact-columns', 'run-log', 'coverage-map', 'pr-inline', 'preview-stage'],
      (list, run) => (gaveUp(run) ? 'gaveup' : waitingAt(list, 'approve-plan') ? 'plan' : ''),
      { gaveup: 'pr-inline', plan: 'artifact-columns' },
    ),
    'prospect-list-to-drafts': firstMatch(
      ['coverage-map', 'triage', 'preview-stage', 'pr-first', 'run-log'],
      (list, run, data) => (waitingAt(list, 'approve-spend') ? 'spend' : waitingAt(list, 'approve') ? (flagged(data) ? 'flag' : 'approve') : ''),
      { spend: 'coverage-map', flag: 'triage', approve: 'pr-first' },
    ),
    'inbox-triage-drafts': firstMatch(
      ['triage', 'buckets', 'preview-stage', 'pr-first', 'run-log'],
      (list, run, data) => (waitingAt(list, 'approve') ? (flagged(data) ? 'flag' : 'approve') : ''),
      { flag: 'triage', approve: 'pr-first' },
    ),
    'data-to-dashboard': firstMatch(
      ['preview-stage', 'artifact-columns', 'coverage-map', 'before-after', 'run-log'],
      (list, run) => (gaveUp(run) ? 'gaveup' : waitingAt(list, 'signoff') ? 'signoff' : ''),
      { gaveup: 'preview-stage', signoff: 'preview-stage' },
    ),
    'study-notes-to-pdf': firstMatch(
      ['preview-stage', 'before-after', 'artifact-columns', 'coverage-map', 'run-log'],
      (list, run, data) => (gaveUp(run) ? 'gaveup' : data && data.unsourced ? 'unsourced' : waitingAt(list, 'signoff') ? 'signoff' : ''),
      { gaveup: 'run-log', unsourced: 'before-after', signoff: 'preview-stage' },
    ),
    'form-fill-batch': firstMatch(
      ['coverage-map', 'triage', 'preview-stage', 'pr-first', 'run-log'],
      (list) => waitingAt(list, 'captcha', 'approve'),
      { captcha: 'preview-stage', approve: 'pr-first' },
      { pick: (run, list) => ({ captcha: 'preview-stage', approve: 'pr-first' }[waitingAt(list, 'captcha', 'approve')] || 'coverage-map') },
    ),
  };
  const LONG_MS = 5000;
  const QUIET_MS = 2000;

  const ruleOf = (pipelineId) => RULES[pipelineId] || { five: LIBRARY, onFail: 'run-log', pick: () => null };

  /** The step the screen is about: a failed one first, then running or waiting, then the last that started. */
  function activeStep(list) {
    const failed = list.find((s) => s.status === 'failed');
    if (failed) return { step: failed, failed: true };
    const live = list.find((s) => s.status === 'running' || s.status === 'waiting');
    if (live) return { step: live, failed: false };
    const started = [...list].reverse().find((s) => s.status !== 'pending' && s.status !== 'skipped');
    return { step: started || list[0] || null, failed: false };
  }

  /** run: { pipeline_id }, pipe: { layout } or null, list: stepsOf().list, manual: a layout name or null, data: the pipeline's own result summary. */
  function pickLayout(run, pipe, list, manual, data) {
    const rule = ruleOf(run.pipeline_id);
    if (manual) return manual;
    const { step, failed } = activeStep(list);
    if (failed) return rule.onFail;
    const hint = step && step.def && step.def.layout;
    if (hint) return hint;
    return rule.pick(run, list, data) || (pipe && pipe.layout) || rule.five[0];
  }

  /**
   * Whether an automatic change from `current` to `next` may happen at `now` (ms).
   * since: ms the active step started running (null if unknown); lastTouch: ms of the user's last click or key.
   * Returns { move: true } or { move: false, retryIn: ms | null }.
   */
  function due(current, next, list, now, since, lastTouch) {
    if (!current || current === next) return { move: !current, retryIn: null };
    const { step, failed } = activeStep(list);
    const status = step ? step.status : null;
    const longRun = status === 'running' && since != null && now - since >= LONG_MS;
    if (!failed && status !== 'waiting' && !longRun) {
      return { move: false, retryIn: status === 'running' && since != null ? LONG_MS - (now - since) : null };
    }
    const quiet = now - lastTouch;
    if (quiet < QUIET_MS) return { move: false, retryIn: QUIET_MS - quiet };
    return { move: true };
  }

  /** Whether a background run should open itself: the pipeline's open rule, or any failed step. */
  function opens(run, list, data) {
    const rule = ruleOf(run.pipeline_id);
    return activeStep(list).failed || Boolean(rule.opens && rule.opens(data, list, run));
  }

  /** Which opening moment the run is at, so a second moment opens a bar the first one already opened. */
  const moment = (run, list, data) => (ruleOf(run.pipeline_id).moment || (() => ''))(list, run, data);

  const FLAGS = ['flag', 'breaking_no_doc', 'licence_conflict', 'high_reachable', 'unsourced'];

  /** detail: runDetail() or null. Returns the rule flags set truthy in any step's outputs, or null when none are. */
  function flagsOf(detail) {
    const set = {};
    for (const out of Object.values((detail && detail.outputs) || {})) {
      if (!out) continue;
      const on = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v) && v !== 'false' && v !== '0');
      for (const k of FLAGS) if (on(out[k])) set[k] = true;
      for (const k of ['flags', 'flags_left']) if (Array.isArray(out[k]) ? out[k].length : Number(out[k]) > 0) set.flag = true;
    }
    return Object.keys(set).length ? set : null;
  }

  root.layoutRules = { LIBRARY, REVIEW, RULES, FLAGS, flagsOf, opens, moment, LONG_MS, QUIET_MS, ruleOf, activeStep, pickLayout, due };
})(globalThis);
