// Fixture for one Footage to edit run of pipelines/footage-to-edit.json. Waiting at approve-final.
// Times are programme seconds unless named src_*. Video is drawn, not played.
window.RUN = {
  pipeline: { id: 'footage-to-edit', title: 'Raw footage to edited video', lane: 'Video and social', plugins: ['media', 'ffmpeg', 'hyperframes'], budget_min: 45 },
  project: { name: 'repotting-talk', dir: '~/footage/repotting-talk' },
  inputs: [['Footage folder', '~/footage/repotting-talk (3 takes, 3:00 in all)'], ['Style', 'talking-head'], ['Target length', '120 s'], ['House style', 'captions two lines, bottom third; music bed under voice, ducked']],
  run: { id: 'run-8c3a', started: '10:14', elapsed: '19m 42s', tokens: '61,300', cost: '$0.48', dir: '~/.metatrooper/runs/run-8c3a' },
  steps: [
    { id: 'inventory', title: 'List the takes', kind: 'action', role: 'ingest', uses: 'plugin:ffmpeg/probe', status: 'done', took: '6s', out: '3 takes, 3:00, 1920x1080 30 fps' },
    { id: 'transcribe', title: 'Transcribe with word times', kind: 'agent', role: 'worker', uses: 'plugin:media/transcribe', fanout: 4, status: 'done', took: '1m 52s', out: 'words.json, 512 words, 1 speaker' },
    { id: 'plan', title: 'Plan the edit', kind: 'agent', role: 'plan', status: 'done', took: '1m 20s', tokens: '14,800', out: 'edit-plan.md, 41 cuts, 5 cues, est. 1:57' },
    { id: 'approve-plan', title: 'Approve the plan', kind: 'gate', gate: 'approve', status: 'done', took: '2m 05s', out: 'approved at 10:20' },
    { id: 'edit', title: 'Edit and render', kind: 'agent', role: 'worker', calls: ['plugin:ffmpeg/cut', 'plugin:hyperframes/render', 'plugin:ffmpeg/render'], status: 'done', took: '10m 31s', tokens: '29,100', out: '41 cuts, 5 overlays, 46 captions; final.mp4, final-9x16.mp4',
      passes: [
        { n: 1, took: '6m 41s', out: 'rough.mp4, 41 cuts, 30 ms fades, 5 overlays' },
        { n: 2, took: '3m 50s', out: '3 flags fixed, 1 left for you; 46 captions; music ducked; final.mp4, final-9x16.mp4' },
      ] },
    { id: 'visual-check', title: 'Check every cut', kind: 'agent', role: 'visual-check', status: 'done', took: '3m 10s', tokens: '17,400', out: '41 cuts checked, 4 flagged; re-check: 3 clean, c28 left for you', passed: true,
      loop: { steps: ['edit', 'visual-check'], until: 'steps.visual-check.passed', max: 2 },
      passes: [
        { n: 1, took: '2m 48s', out: '41 cuts checked in rough.mp4, 4 flagged' },
        { n: 2, took: '22s', out: '4 windows re-checked in final.mp4: 3 clean, c28 left for you' },
      ] },
    { id: 'approve-final', title: 'Watch and approve', kind: 'gate', gate: 'approve', status: 'waiting', waiting: '1m 10s' },
  ],
  // inventory output. shot hints how to draw the grey placeholder frame.
  takes: [
    { id: 'take-01', file: 'take-01.mp4', duration: 72.0, res: '1920x1080', fps: 30, audio_lufs: -19.2, peak_db: -2.8, shot: 'table-wide', note: 'intro and steps 1 to 2; 0:31 to 0:58 has three restarts' },
    { id: 'take-02', file: 'take-02.mp4', duration: 41.0, res: '1920x1080', fps: 30, audio_lufs: -18.6, peak_db: -3.4, shot: 'hands-close', note: 'retake of the roots section' },
    { id: 'take-03', file: 'take-03.mp4', duration: 67.0, res: '1920x1080', fps: 30, audio_lufs: -19.8, peak_db: -3.0, shot: 'table-wide', note: 'soil, watering and outro' },
  ],
  transcribe: { workers: [['w1', 'take-01 0:00 to 0:36', '1m 40s'], ['w2', 'take-01 0:36 to 1:12', '1m 44s'], ['w3', 'take-02', '1m 22s'], ['w4', 'take-03', '1m 52s']], words: 512, speakers: ['Speaker 1'], file: 'words.json' },
  // edit plan as the plan step wrote it; approved at the first gate.
  plan: {
    file: 'edit-plan.md',
    estimate_s: 117,
    md: [
      '# Edit plan',
      '',
      'Target 120 s. Estimate 1:57 after cuts.',
      '',
      '- **Order:** take-01 0:00 to 0:31, take-02 0:03 to 0:39, take-01 0:58 to 1:12, take-03 whole.',
      '- **Swap:** take-02 replaces take-01 0:31.0 to 0:58.4; take-01 restarts three times there, take-02 says it once.',
      '- **Cut:** 17 fillers, 4 false starts, 17 silences over 400 ms, at word boundaries, 30 ms fades.',
      '- **Graphics:** title card, lower third, two step labels, end card (5 cues).',
      '- **Keep:** the laugh at 1:40; it is the only light moment.',
    ],
  },
  approve_plan: { summary: 'Read edit-plan.md. Approve to cut and render; reject to stop before any render.', action: 'Cut 3 takes into one 1:57 timeline with 41 cuts and 5 overlays', hash: 'sha256:5e19a0c7d2', decided: 'approved', at: '10:20' },
  // the programme on V1, in order. src_in and src_out are source seconds.
  clips: [
    { take: 'take-01', src_in: 0.0, src_out: 31.0, prog_in: 0.0, prog_out: 29.4 },
    { take: 'take-02', src_in: 3.1, src_out: 39.0, prog_in: 29.4, prog_out: 61.0 },
    { take: 'take-01', src_in: 58.4, src_out: 72.0, prog_in: 61.0, prog_out: 73.2 },
    { take: 'take-03', src_in: 0.0, src_out: 67.0, prog_in: 73.2, prog_out: 118.4 },
  ],
  // every cut: [id, programme time, kind, what was removed]. kinds: filler, false-start, silence (ms), take (switch).
  cuts: [
    ['c01', 2.8, 'silence', '620'], ['c02', 5.1, 'filler', 'um'], ['c03', 7.9, 'silence', '540'], ['c04', 10.2, 'filler', 'so, uh'],
    ['c05', 13.6, 'silence', '880'], ['c06', 17.0, 'filler', 'like'], ['c07', 21.4, 'false-start', 'You want to, you want to'], ['c08', 24.3, 'silence', '470'],
    ['c09', 27.0, 'filler', 'um'], ['c10', 29.4, 'take', 'take-01 to take-02'], ['c11', 32.5, 'silence', '1120'], ['c12', 35.8, 'filler', 'you know'],
    ['c13', 38.1, 'silence', '430'], ['c14', 41.0, 'filler', 'uh'], ['c15', 43.7, 'false-start', 'The roots, the'], ['c16', 45.2, 'silence', '690'],
    ['c17', 46.4, 'filler', 'um'], ['c18', 47.2, 'silence', '450'], ['c19', 47.9, 'filler', 'um'], ['c20', 51.3, 'silence', '760'],
    ['c21', 54.0, 'filler', 'like'], ['c22', 56.6, 'silence', '520'], ['c23', 58.9, 'filler', 'uh'], ['c24', 61.0, 'take', 'take-02 to take-01'],
    ['c25', 63.4, 'silence', '980'], ['c26', 65.8, 'filler', 'kind of'], ['c27', 67.9, 'false-start', 'and then, and then'], ['c28', 69.6, 'silence', '640'],
    ['c29', 71.2, 'filler', 'um'], ['c30', 73.2, 'take', 'take-01 to take-03'], ['c31', 76.0, 'silence', '1340'], ['c32', 78.7, 'filler', 'so'],
    ['c33', 81.2, 'silence', '580'], ['c34', 84.5, 'filler', 'uh'], ['c35', 88.0, 'silence', '720'], ['c36', 91.6, 'false-start', 'Water it, water it until'],
    ['c37', 95.3, 'filler', 'basically'], ['c38', 99.1, 'silence', '610'], ['c39', 103.4, 'filler', 'um'], ['c40', 108.0, 'silence', '900'],
    ['c41', 113.7, 'filler', 'you know'],
  ],
  cut_counts: { filler: 17, 'false-start': 4, silence: 17, take: 3, total: 41, removed_s: 61.6 },
  // transcript in programme order. Markup: {f:um} filler cut, {r:...} false start cut, {s:620} silence cut (ms), {c:id} graphics cue.
  transcript: [
    { t: 0.0, take: 'take-01', text: '{c:g1}Hi. {s:620}Today we are repotting a plant that has outgrown its pot. {f:um}' },
    { t: 5.2, take: 'take-01', text: '{c:g2}You will need a pot one size up, fresh soil and about ten minutes. {s:540}' },
    { t: 8.0, take: 'take-01', text: '{f:so, uh}First, water the plant the day before. {s:880}It makes the roots easier to loosen, {f:like} and the soil holds together.' },
    { t: 17.1, take: 'take-01', text: '{r:You want to, you want to }Tip the pot on its side and slide the plant out. {s:470}Do not pull it by the stem. {f:um}' },
    { t: 29.4, take: 'take-02', text: '{c:g3}Now the roots. {s:1120}If they circle the bottom, tease them apart with your fingers. {f:you know}' },
    { t: 38.1, take: 'take-02', text: '{s:430}Be gentle. {f:uh}Losing a few small roots is fine. {r:The roots, the }The thick ones are the ones to keep.' },
    { t: 45.2, take: 'take-02', text: '{s:690}{f:um}{s:450}{f:um}So if one is soft or dark, trim it off with clean scissors. {s:760}' },
    { t: 51.4, take: 'take-02', text: '{f:like}That is rot, and it spreads. {s:520}Cut back to firm, pale root. {f:uh}' },
    { t: 61.0, take: 'take-01', text: '{s:980}Put a layer of soil in the new pot, {f:kind of} enough that the plant sits an inch below the rim, {r:and then, and then }' },
    { t: 69.6, take: 'take-01', text: '{s:640}and set it in the middle. {f:um}' },
    { t: 73.2, take: 'take-03', text: '{c:g4}Fill in around it. {s:1340}{f:so}Press the soil down lightly with your fingers. {s:580}No need to pack it hard.' },
    { t: 84.5, take: 'take-03', text: '{f:uh}Leave a little room at the top for water. {s:720}{r:Water it, water it until }Water it until it runs out of the bottom.' },
    { t: 95.3, take: 'take-03', text: '{f:basically}Then keep it out of strong sun for a week while it settles. {s:610}' },
    { t: 99.2, take: 'take-03', text: 'It may droop for a day or two. That is normal. {f:um}Ha, mine always does. {s:900}' },
    { t: 108.1, take: 'take-03', text: '{c:g5}That is it. {f:you know}Thanks for watching.' },
  ],
  // graphics cues, one composition each (fanout 4, so five run in two waves).
  graphics: [
    { id: 'g1', kind: 'title card', text: 'Repotting a houseplant', in: 0.0, out: 4.0, file: 'gfx/g1-title.mov', took: '58s', worker: 'w1' },
    { id: 'g2', kind: 'lower third', text: 'Speaker 1', in: 5.2, out: 9.2, file: 'gfx/g2-lower.mov', took: '41s', worker: 'w2' },
    { id: 'g3', kind: 'step label', text: '1  Loosen the roots', in: 29.6, out: 33.6, file: 'gfx/g3-step1.mov', took: '44s', worker: 'w3' },
    { id: 'g4', kind: 'step label', text: '2  Fresh soil', in: 73.4, out: 77.4, file: 'gfx/g4-step2.mov', took: '39s', worker: 'w4' },
    { id: 'g5', kind: 'end card', text: 'Thanks for watching', in: 113.4, out: 118.4, file: 'gfx/g5-end.mov', took: '1m 02s', worker: 'w1' },
  ],
  // visual-check pass 1: frames and waveform in a 3 s window around each cut. status after edit pass 2.
  flags: [
    { cut: 'c07', t: 21.4, kind: 'jump cut', seen: 'head shifts left between frames 641 and 642', fix: 'punch in to 110% on the after side', status: 'fixed' },
    { cut: 'c19', t: 47.9, kind: 'clipped word', seen: 'the cut takes the first 60 ms of "So"', fix: 'boundary moved 60 ms later', status: 'fixed' },
    { cut: 'c28', t: 69.6, kind: 'rushed', seen: 'the cut removes the breath before "and set it"; the sentence runs on', fix: 'keep the breath (+0.4 s) or keep the cut', status: 'left for you' },
    { cut: 'c33', t: 81.2, kind: 'pop', seen: 'waveform spike at the cut, +9 dB over the fade limit', fix: '30 ms fade was missing; added', status: 'fixed' },
  ],
  second_pass: {
    captions: { count: 46, style: 'two lines, 32 px, bottom third', file: 'edit/captions.srt' },
    music: { file: 'library/ambient-loop-01.wav', note: 'library placeholder', bed_lufs: -30, duck_db: -12, fade_in_s: 1.0, fade_out_s: 2.0 },
    loudness: { voice_lufs: -16.0, final_lufs: -14.0, true_peak_db: -1.0 },
  },
  // seeded RMS curve for drawing the voice waveform; silences come from the cuts.
  wave: { seed: 7, samples_per_s: 20, floor_db: -48, voice_db: -18, peak_db: -3 },
  exports: [
    { file: 'out/final.mp4', res: '1920x1080', fps: 30, duration: 118.4, frames: 3552, size: '41.2 MB', took: '52s' },
    { file: 'out/final-9x16.mp4', res: '1080x1920', fps: 30, duration: 118.4, frames: 3552, size: '38.7 MB', took: '44s', note: 'centre crop, captions re-wrapped to 3 lines' },
  ],
  gate: {
    step: 'approve-final',
    gate: 'approve',
    summary: 'Watch final.mp4. One cut is left for you (c28 at 1:09.6). Approve to mark both files final; reject to send notes back to edit.',
    action: 'Mark out/final.mp4 and out/final-9x16.mp4 approved; nothing is posted',
    hash: 'sha256:b84d2f6a19',
    keys: [['Space', 'Play'], ['J K L', 'Scrub'], ['N', 'Note at playhead'], ['A', 'Approve'], ['R', 'Reject with notes']],
    open_flag: 'c28',
    resolution: { c28: 'keep the cut', duration: 118.4 },
  },
  // timecoded notes for the screening room (from visual-check and edit, plus one by the user in the demo).
  notes: [
    { t: 21.4, by: 'visual-check', text: 'c07 jump cut, punched in to 110%', status: 'fixed' },
    { t: 47.9, by: 'visual-check', text: 'c19 clipped "So", boundary +60 ms', status: 'fixed' },
    { t: 69.6, by: 'visual-check', text: 'c28 breath cut, sentence runs on. Keep the breath or keep the cut?', status: 'open' },
    { t: 81.2, by: 'visual-check', text: 'c33 pop at the cut, fade added', status: 'fixed' },
    { t: 104.6, by: 'edit', text: 'laugh kept as the plan said', status: 'info' },
  ],
  // live agent output per step, for the demo.
  stream: {
    inventory: ['probe take-01.mp4: 1:12.0, 1920x1080, 30 fps, -19.2 LUFS', 'probe take-02.mp4: 0:41.0, 1920x1080, 30 fps, -18.6 LUFS', 'probe take-03.mp4: 1:07.0, 1920x1080, 30 fps, -19.8 LUFS', 'wrote inventory.json (3 takes, 3:00)'],
    transcribe: ['split into 4 jobs: take-01 in two halves, take-02, take-03', 'w1 take-01 0:00 to 0:36: 104 words', 'w2 take-01 0:36 to 1:12: 98 words', 'w3 take-02: 141 words', 'w4 take-03: 169 words', 'wrote words.json (512 words, 1 speaker)'],
    plan: ['read words.json and inventory.json', 'take-01 restarts three times in 0:31.0 to 0:58.4', 'take-02 says the roots section once: swap it in', '41 cuts: 17 fillers, 4 false starts, 17 silences, 3 take switches', '5 graphics cues: title, lower third, two step labels, end card', 'wrote edit-plan.md (est. 1:57)'],
    'edit-1': ['read edit-plan.md: 41 cuts', 'ffmpeg: concat take-01, take-02, take-01, take-03', 'cut c01 silence 620 ms at 0:02.8', 'cut c07 false start at 0:21.4', 'cut c10 take-01 to take-02 at 0:29.4', 'fades: 30 ms at 41 boundaries', 'hyperframes: g1 to g4 on w1 to w4, then g5 on w1', 'wrote edit/rough.mp4 (1:58.4) with 5 overlays'],
    'visual-check-1': ['timeline_view: 41 windows of 3 s', 'c07: frames 641 to 642 differ, jump cut', 'c19: word "So" starts 60 ms before the cut', 'c28: breath removed, gap 0 ms between sentences', 'c33: spike +9 dB at the cut', '4 flagged, 37 clean: loop back to edit (pass 2 of 2)'],
    'edit-2': ['burn 46 captions, two lines, bottom third', 'music bed -30 LUFS, duck -12 dB under voice', 'loudness: final -14 LUFS, true peak -1 dB', 'c07: punch in 110% on the after side, fixed', 'c19: move boundary +60 ms, fixed', 'c33: add 30 ms fade, fixed', 'c28: left for you (keep the breath or the cut)', 'render final.mp4 1920x1080 30 fps: 3552 frames', 'render final-9x16.mp4 1080x1920, centre crop, captions in 3 lines: 3552 frames', 'wrote out/final.mp4 41.2 MB, out/final-9x16.mp4 38.7 MB'],
    'visual-check-2': ['re-check 4 windows in final.mp4', 'c07, c19, c33 clean', 'c28 left for you: a choice, not a fault', 'passed: nothing left the agent can fix'],
  },
  // hand-back after approve-final. Nothing is posted or uploaded.
  handback: {
    items: [
      { n: 1, text: 'Watch final.mp4', size: '41.2 MB', command: 'start out/final.mp4' },
      { n: 2, text: 'Watch final-9x16.mp4', size: '38.7 MB', command: 'start out/final-9x16.mp4' },
      { n: 3, text: 'Schedule the posts', size: 'next pipeline', command: 'run clips-to-scheduled-posts out/', in_app: true },
    ],
    files: [['out/final.mp4', '41.2 MB'], ['out/final-9x16.mp4', '38.7 MB'], ['edit/timeline.otio', '18 KB'], ['edit/captions.srt', '6 KB']],
    line: 'nothing posted',
    folder: '~/.metatrooper/runs/run-8c3a/out',
  },
};
