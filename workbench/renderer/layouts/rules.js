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
  const moment = (run, list) => (ruleOf(run.pipeline_id).moment || (() => ''))(list, run);

  root.layoutRules = { LIBRARY, REVIEW, RULES, opens, moment, LONG_MS, QUIET_MS, ruleOf, activeStep, pickLayout, due };
})(globalThis);
