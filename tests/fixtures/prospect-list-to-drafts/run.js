// Fixture for one Prospect list to drafts run of pipelines/prospect-list-to-drafts.json: steps decided by two engines, DECISIONS.md #8 (approve-spend gate before the external sources step). Waiting at approve.
// Every prospect, business, site and address is invented; domains use the reserved .example TLD. The Gmail account is a test account. Nothing is sent.
window.RUN = {
  pipeline: { id: 'prospect-list-to-drafts', title: 'Prospect list to email drafts', lane: 'Lead gen', plugins: ['agent-reach', 'gmail'], budget_min: 30 },
  project: { name: 'booking-pages-outreach', dir: '~/outreach/booking-pages' },
  inputs: [['Prospect list', '~/outreach/booking-pages/prospects.csv (12 rows)'], ['Offer', 'a one-page booking site for a local shop, set up in a week'], ['Do not contact', '~/outreach/suppress.txt (4 addresses)'], ['Tone', 'plain, under 100 words, one ask, no flattery opener'], ['Gmail account', 'test account (drafts only)']],
  accounts: [['gmail', 'Gmail', 'test account']],
  run: { id: 'run-8c41', started: '14:05', elapsed: '9m 26s', tokens: '31,700', cost: '$0.24', dir: '~/.metatrooper/runs/run-8c41' },
  steps: [
    { id: 'load', title: 'Load and clean the list', kind: 'code', role: 'ingest', status: 'done', took: '1s', out: 'prospects.json, 10 kept: 1 duplicate, 1 on do-not-contact' },
    { id: 'approve-spend', title: 'Approve the site lookups', kind: 'gate', gate: 'approve', guards_step: 'sources', status: 'approved', took: '14s', answered: '2026-10-04T14:05+11:00', out: 'approved by you: 10 sites, up to 30 pages' },
    { id: 'sources', title: 'Fetch each prospect\'s site', kind: 'action', role: 'research', uses: 'plugin:agent-reach/sources', external: true, unconfirmed: 'agent-reach has only inspiration-board today', status: 'done', took: '1m 52s', out: 'sources.json, 27 pages for 10 prospects' },
    { id: 'hook', title: 'One checkable fact each', kind: 'agent', role: 'research', fanout: 4, view: 'items', status: 'done', took: '3m 10s', tokens: '14,800', out: 'hooks.json, 9 facts, 1 prospect without one' },
    { id: 'write', title: 'Write the first emails', kind: 'agent', role: 'worker', status: 'done', took: '2m 04s', tokens: '9,600', out: 'emails.json, 9 emails, 41 to 78 words' },
    { id: 'check', title: 'Check facts and rules', kind: 'agent', role: 'verify', status: 'done', took: '1m 15s', tokens: '7,300', out: '9 checked, 8 pass, 1 left for you' },
    { id: 'approve', title: 'Approve the drafts', kind: 'gate', gate: 'approve', status: 'waiting', waiting: '1m 05s' },
    { id: 'drafts', title: 'Save as Gmail drafts', kind: 'action', role: 'publish', uses: 'plugin:gmail/draft', external: true, unconfirmed: 'no local gmail plugin manifest', status: 'pending' },
  ],
  // prospects.csv after load: [id, business, first name, role, email, site, status, reason]. status: kept | dropped.
  prospects: [
    ['p01', 'Kettle and Spoke Cafe', 'Ana', 'owner', 'ana@kettlespoke.example', 'kettlespoke.example', 'kept', ''],
    ['p02', 'Rook Lane Bikes', 'Theo', 'owner', 'theo@rooklanebikes.example', 'rooklanebikes.example', 'kept', ''],
    ['p03', 'Hollowmere Physio', 'Priya', 'practice manager', 'priya@hollowmerephysio.example', 'hollowmerephysio.example', 'kept', ''],
    ['p04', 'Tinder Street Pottery', 'Jun', 'owner', 'jun@tinderstreet.example', 'tinderstreet.example', 'kept', ''],
    ['p05', 'Gull Point Dog Wash', 'Mae', 'owner', 'mae@gullpoint.example', 'gullpoint.example', 'kept', ''],
    ['p06', 'Rook Lane Bikes', 'Theo', 'owner', 'theo@rooklanebikes.example', 'rooklanebikes.example', 'dropped', 'duplicate of p02'],
    ['p07', 'Fennick Tailoring', 'Omar', 'owner', 'omar@fennick.example', 'fennick.example', 'kept', ''],
    ['p08', 'Larchwood Music Lessons', 'Elif', 'teacher', 'elif@larchwood.example', 'larchwood.example', 'kept', ''],
    ['p09', 'Brindle Barber Co', 'Sam', 'owner', 'sam@brindlebarber.example', 'brindlebarber.example', 'dropped', 'on do-not-contact list'],
    ['p10', 'Saltmarsh Yoga', 'Noor', 'owner', 'noor@saltmarshyoga.example', 'saltmarshyoga.example', 'kept', ''],
    ['p11', 'Quill and Ivy Florist', 'Bea', 'owner', 'bea@quillivy.example', 'quillivy.example', 'kept', ''],
    ['p12', 'Copperleaf Tutoring', 'Raf', 'director', 'raf@copperleaf.example', 'copperleaf.example', 'kept', ''],
  ],
  // hook step output as items: [prospect, fact, exact quote, source url, status]. status: approved (fact found) | dropped.
  hooks: [
    ['p01', 'table bookings are by phone only', 'Bookings by phone only, 7am to 2pm.', 'https://kettlespoke.example/menu', 'approved'],
    ['p02', 'service bookings need a call or a visit', 'Service bookings: call or drop in, Tue to Sat.', 'https://rooklanebikes.example/service', 'approved'],
    ['p03', 'new patients book by email', 'New patients: please email us to book.', 'https://hollowmerephysio.example/new-patients', 'approved'],
    ['p04', 'classes run a waitlist by email', 'Classes fill fast. Join the waitlist by email.', 'https://tinderstreet.example/classes', 'approved'],
    ['p05', 'weekends are walk-in only', 'Walk-ins only on weekends.', 'https://gullpoint.example', 'approved'],
    ['p07', 'fittings by appointment since 1998', 'Fittings by appointment since 1998.', 'https://fennick.example/about', 'approved'],
    ['p08', 'trial lessons are arranged by text', 'Trial lessons: text us your preferred time.', 'https://larchwood.example/trial', 'approved'],
    ['p10', 'none found', '', 'https://saltmarshyoga.example', 'dropped'],
    ['p11', 'wedding consults on Thursdays only', 'Wedding consults on Thursdays only.', 'https://quillivy.example/weddings', 'approved'],
    ['p12', 'term 4 places by phone enquiry', 'Term 4 places open. Enquire by phone.', 'https://copperleaf.example', 'approved'],
  ],
  hook_drops: { p10: 'the site is one image with no text; no checkable fact' },
  // fetched page text the check step matched quotes against (excerpt per source). p07's page does not contain its quote.
  source_text: {
    p01: { url: 'https://kettlespoke.example/menu', fetched: '2026-10-04T14:06+11:00', excerpt: 'Breakfast and lunch, seven days. Bookings by phone only, 7am to 2pm. Groups of 8 or more, please call ahead.' },
    p02: { url: 'https://rooklanebikes.example/service', fetched: '2026-10-04T14:06+11:00', excerpt: 'Full service from $95. Service bookings: call or drop in, Tue to Sat. Most bikes back in two days.' },
    p03: { url: 'https://hollowmerephysio.example/new-patients', fetched: '2026-10-04T14:06+11:00', excerpt: 'First visit is 45 minutes. New patients: please email us to book. Bring any scans you have.' },
    p04: { url: 'https://tinderstreet.example/classes', fetched: '2026-10-04T14:06+11:00', excerpt: 'Six-week wheel classes, Monday and Wednesday nights. Classes fill fast. Join the waitlist by email.' },
    p05: { url: 'https://gullpoint.example', fetched: '2026-10-04T14:07+11:00', excerpt: 'Self-serve tubs and full washes. Weekday appointments by phone. Walk-ins only on weekends.' },
    p07: { url: 'https://fennick.example/about', fetched: '2026-10-04T14:07+11:00', excerpt: 'Family run since 1998. Suits, alterations and repairs. Walk in any weekday; Saturdays by arrangement.' },
    p08: { url: 'https://larchwood.example/trial', fetched: '2026-10-04T14:07+11:00', excerpt: 'Piano and guitar, ages 6 and up. Trial lessons: text us your preferred time. Lessons run after school.' },
    p11: { url: 'https://quillivy.example/weddings', fetched: '2026-10-04T14:07+11:00', excerpt: 'Bouquets, arches and table flowers. Wedding consults on Thursdays only. Book six months ahead.' },
    p12: { url: 'https://copperleaf.example', fetched: '2026-10-04T14:07+11:00', excerpt: 'Maths and English, years 3 to 10. Term 4 places open. Enquire by phone.' },
  },
  // write step output: [prospect, subject, body, words]. The fact is in the first line; one ask; signed by the test account.
  emails: [
    ['p01', 'Bookings at Kettle and Spoke', 'Hi Ana,\n\nYour menu page says bookings are by phone only, 7am to 2pm. That is the busiest stretch to be answering a phone.\n\nI set up one-page booking sites for local shops in about a week: a table picker, your hours, a confirmation by text.\n\nWould a 10-minute call next week be useful?\n\nThanks,\nTest Sender', 58],
    ['p02', 'Service bookings at Rook Lane', 'Hi Theo,\n\nYour service page asks riders to call or drop in, Tue to Sat. A rider who finds you on a Sunday night has nowhere to book.\n\nI build one-page booking sites for local shops, set up in a week, so a service slot can be booked any time.\n\nWorth a short call?\n\nThanks,\nTest Sender', 59],
    ['p03', 'New patient bookings', 'Hi Priya,\n\nHollowmere\'s new-patient page asks people to email to book. Each of those is a back-and-forth before a time is fixed.\n\nI set up one-page booking sites for local clinics in about a week: open times, a form, a confirmation.\n\nCould I send you a two-minute example?\n\nThanks,\nTest Sender', 54],
    ['p04', 'Your class waitlist', 'Hi Jun,\n\nYour classes page says they fill fast and the waitlist runs by email. That is a lot of inbox to keep in order.\n\nI build one-page booking sites with a waitlist that moves people up on its own, set up in a week.\n\nWould an example be useful?\n\nThanks,\nTest Sender', 55],
    ['p05', 'Weekend bookings at Gull Point', 'Hi Mae,\n\nYour site says weekends are walk-ins only. A booking page could let weekday customers lock in a slot while weekends stay walk-in.\n\nI set these up for local shops in about a week.\n\nOpen to a quick look?\n\nThanks,\nTest Sender', 45],
    ['p07', 'Fitting appointments', 'Hi Omar,\n\nI saw Fennick has done fittings by appointment since 1998. A booking page could take those appointments without a phone call.\n\nI build one-page booking sites for local shops, set up in a week.\n\nWould a short example help?\n\nThanks,\nTest Sender', 44],
    ['p08', 'Trial lesson bookings', 'Hi Elif,\n\nLarchwood\'s trial page asks families to text a preferred time. A booking page could show your open slots so they pick one straight away.\n\nI set these up for music teachers in about a week.\n\nCould I send you an example?\n\nThanks,\nTest Sender', 48],
    ['p11', 'Thursday wedding consults', 'Hi Bea,\n\nYour weddings page says consults are on Thursdays only. A booking page could show which Thursdays are still open.\n\nI build one-page booking sites for local shops, set up in a week.\n\nWorth a quick look?\n\nThanks,\nTest Sender', 41],
    ['p12', 'Term 4 enquiries', 'Hi Raf,\n\nCopperleaf\'s site says term 4 places are open by phone enquiry. Families often look in the evening, when nobody is answering.\n\nI set up one-page booking sites with an enquiry form and open places listed, in about a week.\n\nWould a 10-minute call be useful?\n\nThanks,\nTest Sender', 52],
  ],
  // check step: rules per draft. Every draft passed every rule except the flag below.
  checks: { total: 9, pass: 8, items: ['quote found in its fetched page', 'under 100 words', 'no unfilled {{ }}', 'no flattery opener', 'one ask'] },
  flags: [
    { prospect: 'p07', kind: 'fact not in source', seen: 'the hook quotes "Fittings by appointment since 1998" but the fetched page says "Family run since 1998" and "Walk in any weekday"; the email\'s first line is not supported', options: ['drop this draft', 'draft as is'], status: 'left for you' },
  ],
  now: '2026-10-04T14:15+11:00',
  // the approve-spend gate guarded the external lookups; answered before hook started.
  spend_gate: {
    step: 'approve-spend', gate: 'approve', guards_step: 'sources', status: 'approved', answered: '2026-10-04T14:05+11:00',
    summary: 'Fetch up to 3 pages from each of the 10 kept prospect sites through agent-reach. Nothing is written to anyone.',
    action: 'Fetch up to 30 pages from 10 sites via agent-reach/sources (unconfirmed action), all at .example',
    hash: 'sha256:71c0e9b2aa',
  },
  // the approve gate guards the one external step. The hash covers every recipient, subject and body; it changes when p07 is dropped.
  gate: {
    step: 'approve',
    gate: 'approve',
    guards_step: 'drafts',
    summary: 'Read the nine drafts. p07 is left for you: its first line is not on the page it cites. Approve to save the batch as drafts in the test Gmail account; nothing is sent, and nothing leaves this machine before that.',
    action: 'Save 9 Gmail drafts in the test account (not sent): p01 p02 p03 p04 p05 p07 p08 p11 p12, all at .example',
    hash: 'sha256:4be1a07c3d',
    keys: [['J K', 'Next or previous draft'], ['D', 'Drop this draft'], ['A', 'Approve'], ['R', 'Reject']],
    open_flag: 'p07',
    resolution: { p07: 'drop this draft', drops: ['p07'], drafts: 8, action: 'Save 8 Gmail drafts in the test account (not sent): p01 p02 p03 p04 p05 p08 p11 p12, all at .example', hash: 'sha256:d93f0e2a71' },
  },
  // live agent output per step, for the demo.
  stream: {
    hook: ['read sources.json, 27 pages', 'p01 menu: "Bookings by phone only, 7am to 2pm."', 'p02 service: "Service bookings: call or drop in, Tue to Sat."', 'p03 to p12: 7 more facts', 'p10: no text on the page, dropped', 'wrote hooks.json, 9 facts'],
    write: ['read hooks.json and the offer', 'p01: Bookings at Kettle and Spoke, 58 words', 'p02: Service bookings at Rook Lane, 59 words', 'p03 to p12: 7 more', 'wrote emails.json, 9 emails'],
    check: ['match each quote in its fetched page', 'p01 to p05: quote found, rules pass', 'p07: "Fittings by appointment since 1998" not on fennick.example/about', 'p08, p11, p12 pass', '8 pass, 1 left for you'],
    drafts: ['gmail: test account, 8 drafts', 'p01 ana@kettlespoke.example saved as draft', 'p02 theo@rooklanebikes.example saved as draft', 'p03 to p12: 6 more saved', 'wrote out/drafts.json, 8 saved, 0 sent'],
  },
  // after the drafts step. Items status 'published' means Gmail saved the draft; the UI label reads 'drafted'. Nothing was sent.
  drafted: { saved: 8, sent: 0, file: 'out/drafts.json', ids: 'draft-01 to draft-08', folder: 'Gmail Drafts, test account' },
  // numbered hand-back: only what the user can do, each with its command.
  handback: [
    ['Open Drafts in the test account and send the ones you want, by hand', 'start https://mail.google.com/mail/u/0/#drafts'],
    ['Read the batch exactly as saved (8 drafts, recipients, subjects)', 'start out/drafts.json'],
    ['p07 was not drafted: check fennick.example yourself before writing to Omar', 'start out/hooks.json'],
  ],
  handback_line: 'drafted, not sent; you send from Gmail',
  folder: '~/.metatrooper/runs/run-8c41/out',
};
