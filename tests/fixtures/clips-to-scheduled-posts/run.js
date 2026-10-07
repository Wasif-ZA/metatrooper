// Fixture for one Clips to scheduled posts run of pipelines/clips-to-scheduled-posts.json. Waiting at approve.
// Times in the source video are seconds. Slots are ISO with the Sydney offset. Video is drawn, not played. Accounts are test accounts, no handles.
window.RUN = {
  pipeline: { id: 'clips-to-scheduled-posts', title: 'Long video to clips to scheduled posts', lane: 'Video and social', plugins: ['media', 'social-scheduler'], budget_min: 40 },
  project: { name: 'compost-workshop', dir: '~/videos/compost-workshop' },
  inputs: [['Video', '~/videos/compost-workshop/workshop.mp4 (46:20)'], ['Max clips', '8 (so 24 candidates)'], ['Platforms', 'TikTok, Instagram Reels, YouTube Shorts'], ['Posting rule', 'one a day per platform: Reels 12:30, Shorts 17:00, TikTok 18:00, from Tue 6 Oct'], ['House style', 'captions two lines, 64 px, centre; hook line in the first 2 s']],
  accounts: [['tiktok', 'TikTok', 'test account'], ['reels', 'Instagram Reels', 'test account'], ['shorts', 'YouTube Shorts', 'test account']],
  run: { id: 'run-5d21', started: '13:02', elapsed: '24m 18s', tokens: '48,900', cost: '$0.39', dir: '~/.metatrooper/runs/run-5d21' },
  steps: [
    { id: 'ingest', title: 'Load the video', kind: 'action', role: 'ingest', uses: 'plugin:media/download', status: 'done', took: '9s', out: 'workshop.mp4, 46:20, 1920x1080 30 fps' },
    { id: 'transcribe', title: 'Transcribe and find scenes', kind: 'action', role: 'worker', uses: 'plugin:media/transcribe', status: 'done', took: '6m 40s', out: 'words.json 7,912 words, 1 speaker; scenes.json 63 scenes' },
    { id: 'moments', title: 'Find candidate moments', kind: 'agent', role: 'research', view: 'items', status: 'done', took: '2m 05s', tokens: '19,300', out: 'moments.md, 24 candidates, 15 to 60 s' },
    { id: 'pick', title: 'Pick the clips', kind: 'gate', gate: 'handoff', status: 'done', took: '3m 12s', out: '6 picked, 18 dropped' },
    { id: 'cut', title: 'Cut and reframe 9:16', kind: 'action', role: 'worker', uses: 'plugin:media/cut', fanout: 4, status: 'done', took: '3m 48s', out: '6 clips, 1080x1920, speaker tracked' },
    { id: 'style', title: 'Captions and hook line', kind: 'action', role: 'worker', uses: 'plugin:media/captions', fanout: 4, status: 'done', took: '4m 02s', out: '6 styled clips, 212 caption lines' },
    { id: 'copy', title: 'Write copy per platform', kind: 'agent', role: 'worker', status: 'done', took: '1m 30s', tokens: '11,200', out: '18 captions with titles and hashtags' },
    { id: 'check', title: 'Check frames and safe zones', kind: 'agent', role: 'visual-check', status: 'done', took: '1m 41s', tokens: '18,400', out: '18 checks, 17 pass, 1 left for you' },
    { id: 'approve', title: 'Approve clips and slots', kind: 'gate', gate: 'approve', status: 'waiting', waiting: '2m 05s' },
    { id: 'schedule', title: 'Schedule the posts', kind: 'action', role: 'publish', uses: 'plugin:social-scheduler/schedule_post', external: true, status: 'pending' },
  ],
  // moments step output: [id, src start s, src end s, hook, payoff, reason, status after pick]. No score: the reason is the case for it.
  moments: [
    ['m01', 62, 101, 'Most compost fails for one reason.', 'It is too wet, not too dry.', 'a claim, then the surprise answer', 'dropped'],
    ['m02', 188, 214, 'Here is what a dead heap looks like.', 'grey, cold, smells sour', 'visual, but needs the next minute to land', 'dropped'],
    ['m03', 305, 349, 'Greens and browns, in one sentence.', 'two buckets of browns for every one of greens', 'one rule, stated cleanly, stands alone', 'picked'],
    ['m04', 402, 440, 'You do not need a bin.', 'a pile in a corner works', 'contrarian, but the payoff is weak', 'dropped'],
    ['m05', 512, 559, 'Put your hand in it.', 'warm in the middle means it is working', 'a physical test anyone can copy', 'picked'],
    ['m06', 640, 671, 'Eggshells: yes or no?', 'yes, crushed', 'common question, short answer', 'dropped'],
    ['m07', 733, 790, 'The smell test.', 'sweet is fine, sour is not', 'overlaps m05; keep one test', 'dropped'],
    ['m08', 845, 889, 'Why I stopped turning mine weekly.', 'once a month is enough', 'good, but leans on the earlier setup', 'dropped'],
    ['m09', 961, 1003, 'What not to put in.', 'meat, dairy, oil, and why each one', 'a list people save', 'picked'],
    ['m10', 1088, 1120, 'Coffee grounds count as green.', 'despite being brown', 'short, a little thin', 'dropped'],
    ['m11', 1190, 1247, 'Too many flies?', 'bury the fresh scraps under browns', 'a fix, but the demo is off camera', 'dropped'],
    ['m12', 1302, 1340, 'A question from the room.', 'answered at 23:40', 'needs the question audible; it is not', 'dropped'],
    ['m13', 1411, 1455, 'The cardboard trick.', 'tear it small, wet it first', 'clear, but similar to m03', 'dropped'],
    ['m14', 1530, 1588, 'This is what finished compost looks like.', 'dark, crumbly, smells like forest floor', 'the before and after people want', 'picked'],
    ['m15', 1660, 1699, 'How long does it take?', 'two to six months', 'a number, no story', 'dropped'],
    ['m16', 1744, 1790, 'Winter slows it down.', 'insulate with leaves', 'seasonal, posts badly in spring', 'dropped'],
    ['m17', 1856, 1902, 'Worms or no worms?', 'either works, worms are faster', 'starts mid-answer; no hook in the first 2 s', 'dropped'],
    ['m18', 1975, 2031, 'Sieve it before you use it.', 'the big bits go back in the heap', 'a satisfying hands demo', 'picked'],
    ['m19', 2102, 2140, 'The joke about the neighbour.', 'punchline at 35:40', 'the punchline needs 20 s of setup outside the clip', 'dropped'],
    ['m20', 2215, 2259, 'Can you compost in a flat?', 'a small bokashi bucket', 'good, but a different topic', 'dropped'],
    ['m21', 2320, 2361, 'Three mistakes in a row.', 'wet, flat, and too many greens', 'repeats m01, m03', 'dropped'],
    ['m22', 2430, 2477, 'Start with what you have.', 'a bag of leaves and this week\'s scraps', 'the closing line; ends on a call to start', 'picked'],
    ['m23', 2540, 2580, 'Thanks and questions.', 'none', 'no payoff', 'dropped'],
    ['m24', 2655, 2700, 'One last tip.', 'keep a lid on it in heavy rain', 'useful, but trails off at the end', 'dropped'],
  ],
  pick_gate: { gate: 'handoff', summary: 'Read moments.md. Pick the clips to make; nothing is cut before you pick.', action: 'Cut and style 6 clips: m03, m05, m09, m14, m18, m22', hash: 'sha256:3a90c1e7b4', decided: 'continued', at: '13:11' },
  // the picked clips after cut and style. caption_y is the caption box top and bottom in the 1080x1920 frame. shot hints the grey placeholder frame.
  clips: [
    { id: 'k1', moment: 'm03', file: 'out/clips/k1-9x16.mp4', src_in: 305.2, src_out: 348.6, duration: 43.4, hook: 'Greens and browns, in one sentence.', shot: 'speaker-mid', caption_y: [1380, 1470] },
    { id: 'k2', moment: 'm05', file: 'out/clips/k2-9x16.mp4', src_in: 512.0, src_out: 558.7, duration: 46.7, hook: 'Put your hand in it.', shot: 'hands-heap', caption_y: [1380, 1470] },
    { id: 'k3', moment: 'm09', file: 'out/clips/k3-9x16.mp4', src_in: 960.8, src_out: 1002.9, duration: 42.1, hook: 'What not to put in.', shot: 'speaker-mid', caption_y: [1380, 1470] },
    { id: 'k4', moment: 'm14', file: 'out/clips/k4-9x16.mp4', src_in: 1530.4, src_out: 1587.6, duration: 57.2, hook: 'This is what finished compost looks like.', shot: 'hands-heap', caption_y: [1380, 1470] },
    { id: 'k5', moment: 'm18', file: 'out/clips/k5-9x16.mp4', src_in: 1975.1, src_out: 2030.5, duration: 55.4, hook: 'Sieve it before you use it.', shot: 'hands-sieve', caption_y: [1520, 1610], style_note: 'captions moved down: the sieve fills the top third' },
    { id: 'k6', moment: 'm22', file: 'out/clips/k6-9x16.mp4', src_in: 2430.0, src_out: 2476.8, duration: 46.8, hook: 'Start with what you have.', shot: 'speaker-mid', caption_y: [1380, 1470] },
  ],
  // cut and style workers (fanout 4 each, so six clips run in two waves).
  workers: {
    cut: [['w1', 'k1, k5', '1m 52s'], ['w2', 'k2, k6', '1m 58s'], ['w3', 'k3', '0m 54s'], ['w4', 'k4', '1m 06s']],
    style: [['w1', 'k1, k5', '2m 01s'], ['w2', 'k2, k6', '2m 04s'], ['w3', 'k3', '1m 02s'], ['w4', 'k4', '1m 10s']],
  },
  // burned caption lines per clip, first lines only, for drawing.
  captions: {
    k1: ['Greens and browns,', 'in one sentence.', 'Two buckets of browns', 'for every one of greens.'],
    k2: ['Put your hand in it.', 'Right in the middle.', 'Warm means it is working.'],
    k3: ['What not to put in.', 'Meat, dairy, oil.', 'They smell, and they', 'bring the rats.'],
    k4: ['This is what finished', 'compost looks like.', 'Dark, crumbly, and it', 'smells like forest floor.'],
    k5: ['Sieve it before', 'you use it.', 'The big bits go', 'back in the heap.'],
    k6: ['Start with what you have.', 'A bag of leaves', 'and this week\'s scraps.'],
  },
  // UI zones per platform in a 1080x1920 frame (fixture values): captions must sit above bottom_ui and below top_ui.
  safe_zones: { tiktok: { top_ui: 160, bottom_ui: 1640, right_ui: 940 }, reels: { top_ui: 200, bottom_ui: 1500, right_ui: 960 }, shorts: { top_ui: 180, bottom_ui: 1580, right_ui: 950 } },
  // copy step output: per clip, per platform [title or first line, hashtags].
  copy: {
    k1: { tiktok: ['The only compost rule you need', '#compost #gardening'], reels: ['Two to one. That is the rule.', '#compost #homegarden'], shorts: ['Greens vs browns in 40 seconds', '#compost #shorts'] },
    k2: { tiktok: ['Is your compost working? Hand test.', '#compost #gardentips'], reels: ['Warm in the middle = working', '#compost #homegarden'], shorts: ['The hand test for compost', '#compost #shorts'] },
    k3: { tiktok: ['Never put these in your compost', '#compost #gardening'], reels: ['Three things to keep out', '#compost #homegarden'], shorts: ['What not to compost', '#compost #shorts'] },
    k4: { tiktok: ['Finished compost, up close', '#compost #satisfying'], reels: ['Six months later', '#compost #homegarden'], shorts: ['What done looks like', '#compost #shorts'] },
    k5: { tiktok: ['Sieve your compost first', '#compost #gardentips'], reels: ['The sieve step', '#compost #homegarden'], shorts: ['Why I sieve my compost', '#compost #shorts'] },
    k6: { tiktok: ['How to start a compost heap today', '#compost #beginner'], reels: ['Start with leaves and scraps', '#compost #homegarden'], shorts: ['Start compost this week', '#compost #shorts'] },
  },
  // check step: one row per clip and platform that did not pass cleanly. Every other pair passed.
  checks: { total: 18, pass: 17, items: ['speaker or subject in frame', 'captions inside safe zones', 'no cut mid-word', 'hook in the first 2 s'] },
  flags: [
    { clip: 'k5', platform: 'reels', t: 3.0, kind: 'safe zone', seen: 'captions at 1520 to 1610 px sit under the Reels bottom UI (from 1500 px); TikTok and Shorts pass', options: ['drop Reels for k5', 'post as is'], status: 'left for you' },
  ],
  // posts as proposed by the posting rule: [id, clip, platform, slot]. 6 clips x 3 platforms.
  posts: [
    ['p01', 'k1', 'reels', '2026-10-06T12:30+11:00'], ['p02', 'k1', 'shorts', '2026-10-06T17:00+11:00'], ['p03', 'k1', 'tiktok', '2026-10-06T18:00+11:00'],
    ['p04', 'k2', 'reels', '2026-10-07T12:30+11:00'], ['p05', 'k2', 'shorts', '2026-10-07T17:00+11:00'], ['p06', 'k2', 'tiktok', '2026-10-07T18:00+11:00'],
    ['p07', 'k3', 'reels', '2026-10-08T12:30+11:00'], ['p08', 'k3', 'shorts', '2026-10-08T17:00+11:00'], ['p09', 'k3', 'tiktok', '2026-10-08T18:00+11:00'],
    ['p10', 'k4', 'reels', '2026-10-09T12:30+11:00'], ['p11', 'k4', 'shorts', '2026-10-09T17:00+11:00'], ['p12', 'k4', 'tiktok', '2026-10-09T18:00+11:00'],
    ['p13', 'k5', 'reels', '2026-10-10T12:30+11:00'], ['p14', 'k5', 'shorts', '2026-10-10T17:00+11:00'], ['p15', 'k5', 'tiktok', '2026-10-10T18:00+11:00'],
    ['p16', 'k6', 'reels', '2026-10-11T12:30+11:00'], ['p17', 'k6', 'shorts', '2026-10-11T17:00+11:00'], ['p18', 'k6', 'tiktok', '2026-10-11T18:00+11:00'],
  ],
  now: '2026-10-04T13:26+11:00',
  // the approve gate guards the one external step. The hash covers every post, platform and slot; it changes when k5 Reels is dropped.
  gate: {
    step: 'approve',
    gate: 'approve',
    guards_step: 'schedule',
    summary: 'Watch the six clips and read the slots. k5 on Reels is left for you (captions under the Reels UI). Approve to send the batch to the scheduler; nothing leaves this machine before that.',
    action: 'Schedule 18 posts (6 clips on TikTok, Reels, Shorts) from Tue 6 Oct 12:30 to Sun 11 Oct 18:00 on the test accounts',
    hash: 'sha256:c71e04b9a2',
    keys: [['Space', 'Play'], ['1 2 3', 'Platform tab'], ['D', 'Drop this post'], ['A', 'Approve'], ['R', 'Reject']],
    open_flag: 'k5',
    resolution: { k5: 'drop Reels for k5', drops: ['p13'], posts: 17, action: 'Schedule 17 posts (6 clips; k5 not on Reels) from Tue 6 Oct 12:30 to Sun 11 Oct 18:00 on the test accounts', hash: 'sha256:9f2b7d150e' },
  },
  // live agent output per step, for the demo.
  stream: {
    copy: ['read moments.md reasons for 6 clips', 'k1 tiktok: The only compost rule you need', 'k1 reels: Two to one. That is the rule.', 'k1 shorts: Greens vs browns in 40 seconds', 'k2 to k6: 15 more', 'wrote copy.json, 18 entries'],
    check: ['sample 12 frames per clip per platform', 'k1 to k4: speaker in frame, captions clear, no mid-word cut', 'k5 tiktok pass, shorts pass', 'k5 reels: captions 1520 to 1610 px under bottom UI from 1500 px', 'k6 pass', '17 pass, 1 left for you'],
    schedule: ['social-scheduler: 17 posts, test accounts', 'p01 reels 2026-10-06T12:30+11:00 accepted', 'p02 shorts 2026-10-06T17:00+11:00 accepted', 'p03 tiktok 2026-10-06T18:00+11:00 accepted', 'p04 to p18: 14 more accepted', 'wrote out/schedule.json, 17 accepted, 0 rejected'],
  },
  // after schedule. Items pane status 'published' means the scheduler accepted the post for its slot; the UI label reads 'scheduled'.
  scheduled: { accepted: 17, rejected: 0, first: '2026-10-06T12:30+11:00', last: '2026-10-11T18:00+11:00', file: 'out/schedule.json', ids: 'sched-0001 to sched-0017' },
  // numbered hand-back: only what the user can do, each with its command.
  handback: [
    ['Watch the six clips once more', 'start out/clips'],
    ['Read the batch the scheduler accepted (17 posts, ids, slots)', 'start out/schedule.json'],
    ['k5 was not sent to Reels: post it by hand if you want it there', 'start out/clips/k5-9x16.mp4'],
  ],
  handback_line: 'scheduled, not yet live; the platforms post at each slot',
  folder: '~/.metatrooper/runs/run-5d21/out',
};
