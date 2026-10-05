// Picks the layout a pipeline run is shown on, and decides when an automatic pick may move the screen.
(function (root) {
  const LIBRARY = ['run-log', 'artifact-columns', 'pr-first', 'pipe', 'agent-split'];
  const RULES = {
    'spec-to-pr': { five: LIBRARY, onFail: 'run-log', pick: () => null },
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

  /** run: { pipeline_id }, pipe: { layout } or null, list: stepsOf().list, manual: a layout name or null. */
  function pickLayout(run, pipe, list, manual) {
    const rule = ruleOf(run.pipeline_id);
    if (manual) return manual;
    const { step, failed } = activeStep(list);
    if (failed) return rule.five.includes('run-log') ? 'run-log' : rule.onFail;
    const hint = step && step.def && step.def.layout;
    if (hint) return hint;
    return rule.pick(run, list) || (pipe && pipe.layout) || 'run-log';
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

  root.layoutRules = { LIBRARY, RULES, LONG_MS, QUIET_MS, ruleOf, activeStep, pickLayout, due };
})(globalThis);
