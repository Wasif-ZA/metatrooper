// Fixture for one SEO audit and fix run of pipelines/seo-audit-fix.json. Waiting at the approve gate.
window.RUN = {
  pipeline: { id: 'seo-audit-fix', title: 'SEO audit and fix', lane: 'SEO', requires: ['seo', 'repo', 'deploy'], inferred: true },
  project: { name: 'plant-shop', repo: 'acme/plant-shop' },
  inputs: [['Site URL', 'https://plant-shop.example'], ['Repo', 'acme/plant-shop'], ['Market', 'ecommerce']],
  run: { id: 'run-4e1a', started: '10:05', elapsed: '54m 30s', tokens: '130,490', cost: '$1.20', branch: 'mt/seo-run-4e1a', dev: 'http://127.0.0.1:4520' },
  steps: [
    { id: 'crawl', title: 'Crawl the site', kind: 'action', role: 'ingest', uses: 'plugin:seo/crawl', status: 'done', took: '1m 32s', out: '14 URLs, 61 images, health 43' },
    { id: 'audit', title: 'Audit five areas', kind: 'agent', role: 'review', fanout: 5, status: 'done', took: '6m 05s', tokens: '38,400', out: '10 issues: 2 critical, 3 high, 4 medium, 1 low' },
    { id: 'prioritise', title: 'Rank the fixes', kind: 'agent', role: 'plan', status: 'done', took: '2m 14s', tokens: '9,960', out: '10 ranked, 9 to fix, 1 needs a writer' },
    { id: 'fix', title: 'Fix in the repo', kind: 'agent', role: 'worker', worktree: true, status: 'done', took: '21m 47s', tokens: '48,730', out: '4 commits, 16 files, 9 of 10 fixed' },
    { id: 'speed', title: 'Lighthouse until 90', kind: 'agent', role: 'verify', uses: 'plugin:seo/lighthouse', status: 'done', took: '18m 30s', tokens: '33,400', out: '3 rounds, 2 commits, worst page 93', loop: { max: 3, rounds: 3 } },
    { id: 'approve', title: 'Approve the diff for deploy', kind: 'gate', status: 'waiting', waiting: '2m 21s' },
    { id: 'deploy', title: 'Deploy to production', kind: 'action', role: 'publish', external: true, uses: 'plugin:deploy/production', status: 'pending' },
  ],
  // crawl: one row per internal URL. checks: ok | warn | error, per audit area.
  crawl: {
    pages: 14, images: 61, took: '1m 32s',
    areas: ['technical', 'on-page', 'schema', 'content', 'images'],
    urls: [
      { url: '/', status: 200, title: 'Plant Shop: indoor plants delivered', checks: ['ok', 'ok', 'ok', 'ok', 'warn'] },
      { url: '/products', status: 200, title: 'All plants', checks: ['error', 'warn', 'ok', 'ok', 'warn'] },
      { url: '/products/monstera', status: 200, title: 'Monstera', checks: ['error', 'ok', 'warn', 'ok', 'warn'] },
      { url: '/products/snake-plant', status: 200, title: 'Snake plant', checks: ['error', 'ok', 'warn', 'ok', 'ok'] },
      { url: '/products/fiddle-leaf-fig', status: 200, title: 'Fiddle leaf fig', checks: ['error', 'ok', 'warn', 'ok', 'warn'] },
      { url: '/products/zz-plant', status: 200, title: 'Plant', checks: ['error', 'warn', 'warn', 'ok', 'ok'] },
      { url: '/products/pothos', status: 200, title: 'Plant', checks: ['error', 'warn', 'warn', 'ok', 'warn'] },
      { url: '/products/calathea', status: 200, title: 'Calathea', checks: ['error', 'ok', 'warn', 'ok', 'ok'] },
      { url: '/care-guides', status: 200, title: 'Care guides', checks: ['ok', 'warn', 'ok', 'ok', 'ok'] },
      { url: '/care-guides/watering', status: 200, title: 'How often to water', checks: ['ok', 'ok', 'ok', 'ok', 'warn'] },
      { url: '/care-guides/light', status: 200, title: 'Light for indoor plants', checks: ['ok', 'ok', 'ok', 'ok', 'ok'] },
      { url: '/care-guides/repotting', status: 200, title: 'Repotting', checks: ['error', 'ok', 'ok', 'ok', 'warn'] },
      { url: '/about', status: 200, title: 'About', checks: ['ok', 'warn', 'ok', 'warn', 'ok'] },
      { url: '/contact', status: 200, title: 'Contact', checks: ['ok', 'ok', 'ok', 'ok', 'ok'] },
    ],
    // health = URLs without an error / all internal URLs * 100. Errors on 8 URLs (7 blocked by robots.txt, 1 broken link).
    health: { before: 43, before_working: '(14 - 8) / 14 = 6 / 14 = 0.43, so 43', after: 100, after_working: '(14 - 0) / 14 = 1.00, so 100' },
  },
  // audit fanout: one lane per area.
  audit: [
    { lane: 1, area: 'technical', status: 'done', took: '1m 48s', found: 4 },
    { lane: 2, area: 'on-page', status: 'done', took: '1m 21s', found: 2 },
    { lane: 3, area: 'schema', status: 'done', took: '1m 10s', found: 1 },
    { lane: 4, area: 'content', status: 'done', took: '2m 02s', found: 1 },
    { lane: 5, area: 'images', status: 'done', took: '1m 55s', found: 2 },
  ],
  // prioritise: ranked by impact over effort. fixed = the commit that fixed it, null when left for the user.
  issues: [
    { id: 'i1', rank: 1, priority: 'critical', area: 'technical', urls: 7, impact: 'high', effort: 'low', title: 'robots.txt blocks /products/', why: 'Disallow: /products/ hides the category and all 6 product pages from search.', fix: 'remove the Disallow line; keep /cart and /checkout blocked', commit: 'a3f1c20' },
    { id: 'i2', rank: 2, priority: 'critical', area: 'technical', urls: 14, impact: 'high', effort: 'low', title: 'No sitemap.xml', why: 'Search engines find pages only by links; nothing lists the 14 URLs.', fix: 'generate sitemap.xml at build, link it from robots.txt', commit: 'a3f1c20' },
    { id: 'i3', rank: 3, priority: 'high', area: 'schema', urls: 6, impact: 'high', effort: 'medium', title: 'No Product schema on product pages', why: 'Price and stock cannot show in results without Product markup.', fix: 'JSON-LD Product with name, image, offers.price, availability', commit: 'c19d7a5' },
    { id: 'i4', rank: 4, priority: 'high', area: 'images', urls: 1, impact: 'high', effort: 'low', title: 'Hero image is 1.8 MB', why: 'The home page LCP is 4.6 s; the hero JPEG is the LCP element.', fix: 'WebP at 1600 and 800 wide with srcset, 210 KB', commit: 'd4e0b36' },
    { id: 'i5', rank: 5, priority: 'high', area: 'technical', urls: 1, impact: 'medium', effort: 'low', title: 'Broken internal link', why: '/care-guides/repotting links to /care-guides/repoting-tips, which is 404.', fix: 'link corrected to /care-guides/repotting-tips', commit: 'a3f1c20' },
    { id: 'i6', rank: 6, priority: 'medium', area: 'on-page', urls: 2, impact: 'medium', effort: 'low', title: 'Duplicate title "Plant"', why: '/products/zz-plant and /products/pothos share one title.', fix: 'titles from the product name and one keyword', commit: 'b82e4d1' },
    { id: 'i7', rank: 7, priority: 'medium', area: 'on-page', urls: 3, impact: 'medium', effort: 'low', title: 'Meta description missing', why: 'Search shows a scraped snippet for /products, /care-guides and /about.', fix: 'one written description each, 140 to 155 characters', commit: 'b82e4d1' },
    { id: 'i8', rank: 8, priority: 'medium', area: 'images', urls: 7, impact: 'low', effort: 'low', title: 'Alt text missing on 9 images', why: 'Screen readers and image search get nothing.', fix: 'alt from the product or guide subject', commit: 'd4e0b36' },
    { id: 'i9', rank: 9, priority: 'medium', area: 'technical', urls: 1, impact: 'low', effort: 'low', title: 'Redirect chain /shop to /store to /products', why: 'Two hops before the page loads.', fix: '/shop and /store both go straight to /products', commit: 'a3f1c20' },
    { id: 'i10', rank: 10, priority: 'low', area: 'content', urls: 1, impact: 'low', effort: 'high', title: '/about is 140 words', why: 'Thin page; it needs real words about the shop, which an agent should not invent.', fix: null, left: 'needs a writer' },
  ],
  // fix step: one commit per area.
  commits: [
    { hash: 'a3f1c20', area: 'technical', msg: 'Unblock /products, add sitemap.xml, fix link and redirect chain', files: ['robots.txt', 'scripts/sitemap.js', 'package.json', 'src/pages/care-guides/repotting.html', 'vercel.json'], adds: 64, dels: 9 },
    { hash: 'b82e4d1', area: 'on-page', msg: 'Unique titles and meta descriptions', files: ['src/data/products.json', 'src/pages/products/index.html', 'src/pages/care-guides/index.html', 'src/pages/about.html', 'src/layout/head.html'], adds: 22, dels: 8 },
    { hash: 'c19d7a5', area: 'schema', msg: 'Product JSON-LD on product pages', files: ['src/layout/product.html', 'src/lib/jsonld.js'], adds: 41, dels: 0 },
    { hash: 'd4e0b36', area: 'images', msg: 'WebP hero with srcset, alt text on 9 images', files: ['src/img/hero.webp', 'src/img/hero-800.webp', 'src/pages/index.html', 'src/layout/product.html', 'src/pages/care-guides/watering.html', 'src/pages/care-guides/repotting.html'], adds: 37, dels: 18 },
    { hash: 'e7a2f19', area: 'speed', msg: 'Preload hero, lazy-load images below the fold', files: ['src/layout/head.html', 'src/layout/product.html'], adds: 9, dels: 3 },
    { hash: 'f0b5c82', area: 'speed', msg: 'Defer analytics script, font-display swap', files: ['src/layout/head.html', 'src/styles/fonts.css'], adds: 4, dels: 2 },
  ],
  diff: { base: 'main', head: 'f0b5c82', commits: 6, files: 17, adds: 177, dels: 40 },
  // speed loop. Lab scores on the local build; no field data before deploy. pass = every key page 90 or more.
  // before = main, measured once before round 1. Each round measures performance, then fixes and commits if a page is under 90.
  speed: {
    pages: ['/', '/products/monstera', '/care-guides/watering'],
    before: { '/': { performance: 58, seo: 83, lcp: '4.6 s', cls: 0.12 }, '/products/monstera': { performance: 71, seo: 75, lcp: '3.1 s', cls: 0.04 }, '/care-guides/watering': { performance: 82, seo: 92, lcp: '2.4 s', cls: 0.02 } },
    rounds: [
      { round: 1, verdict: 'fixed', commit: 'e7a2f19', scores: { '/': 86, '/products/monstera': 92, '/care-guides/watering': 95 }, note: 'home 86 under 90: hero not preloaded' },
      { round: 2, verdict: 'fixed', commit: 'f0b5c82', scores: { '/': 89, '/products/monstera': 94, '/care-guides/watering': 96 }, note: 'home 89 under 90: analytics blocks the main thread 310 ms' },
      { round: 3, verdict: 'pass', commit: null, scores: { '/': 93, '/products/monstera': 95, '/care-guides/watering': 96 }, note: 'all three 90 or more' },
    ],
    after: { '/': { performance: 93, seo: 100, lcp: '1.9 s', cls: 0.01 }, '/products/monstera': { performance: 95, seo: 100, lcp: '1.6 s', cls: 0.02 }, '/care-guides/watering': { performance: 96, seo: 100, lcp: '1.4 s', cls: 0.01 } },
  },
  // live agent output per step, for the demo.
  stream: {
    crawl: ['seo crawl https://plant-shop.example', 'robots.txt: Disallow: /products/', 'sitemap.xml: 404', '14 internal URLs, 61 images', 'errors on 8 URLs, health 43'],
    audit: ['lane 1 technical: robots, sitemap, broken link, redirect chain', 'lane 2 on-page: duplicate title x2, meta missing x3', 'lane 3 schema: no Product on 6 pages', 'lane 4 content: /about 140 words', 'lane 5 images: hero 1.8 MB, alt missing x9'],
    prioritise: ['merge 5 lanes: 10 issues', 'rank by impact over effort', '2 critical, 3 high, 4 medium, 1 low', 'i10 /about needs a writer, not an agent', 'wrote FIXES.md'],
    fix: ['worktree mt/seo-run-4e1a', 'technical: robots.txt, sitemap.js, link, redirects', 'commit a3f1c20', 'on-page: titles and metas', 'commit b82e4d1', 'schema: Product JSON-LD', 'commit c19d7a5', 'images: hero.webp 210 KB, alt x9', 'commit d4e0b36'],
    speed: ['serve http://127.0.0.1:4520', 'round 1: / 86, /products/monstera 92, /care-guides/watering 95', 'preload hero, lazy-load below the fold; commit e7a2f19', 'round 2: / 89, 94, 96', 'defer analytics, font-display swap; commit f0b5c82', 'round 3: / 93, 95, 96', 'verdict pass', 're-check: errors on 0 of 14 URLs, health 100'],
    deploy: ['deploy mt/seo-run-4e1a (f0b5c82)', 'Building', 'Ready', 'aliased https://plant-shop.example', 'live; sitemap.xml served, 14 URLs'],
  },
  gate: {
    step: 'approve',
    summary: 'Approve the diff for deploy: 6 commits, 17 files. 9 of 10 issues fixed, health 43 to 100, worst key page 93.',
    action: 'Deploy mt/seo-run-4e1a (f0b5c82) to production at https://plant-shop.example',
    hash: 'sha256:8b31e07f2c',
    keys: [['A', 'Approve'], ['R', 'Reject']],
  },
  // done state: what only the user can do. The run never pushes.
  handback: [
    ['Push the branch', 'git push -u origin mt/seo-run-4e1a'],
    ['Submit the sitemap in Search Console', 'open https://search.google.com/search-console/sitemaps and add https://plant-shop.example/sitemap.xml'],
    ['Write /about (i10): about 400 words on the shop', 'open src/pages/about.html'],
  ],
  // deploy failed after approve.
  fail: {
    step: 'deploy', status: 'failed', took: '27s',
    stream: ['deploy mt/seo-run-4e1a (f0b5c82)', 'Building', 'Error: build exited 1', 'scripts/sitemap.js: SITE_URL is not set in the production environment', 'deploy cancelled, nothing went live'],
    error_line: 2,
  },
  // speed ran 3 rounds; home page still under 90.
  gaveup: [
    { round: 1, verdict: 'fixed', commit: 'e7a2f19', scores: { '/': 78, '/products/monstera': 92, '/care-guides/watering': 95 }, note: 'home 78: hero not preloaded' },
    { round: 2, verdict: 'fixed', commit: 'f0b5c82', scores: { '/': 82, '/products/monstera': 94, '/care-guides/watering': 96 }, note: 'home 82: analytics blocks the main thread 310 ms' },
    { round: 3, verdict: 'under 90', commit: null, scores: { '/': 84, '/products/monstera': 95, '/care-guides/watering': 96 }, note: 'home 84: third-party chat widget 1.2 s of main thread, not ours to remove', unfixed: true },
  ],
  result: { url: 'https://plant-shop.example', commit: 'f0b5c82', took: '41s', status: 'live', sitemap: 'served at /sitemap.xml, 14 URLs; not submitted (hand-back 2)' },
};
