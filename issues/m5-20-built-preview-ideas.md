# M5-20 Mined ideas for website-build and design-variants

Child of Milestone 5 in `spec.md`. Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

## Where this comes from

The 2026-10-09 repo scan read 44 relevant repos for `website-build` and 41 for `design-variants`. Their tables, top
ideas and hardening notes are in `ide-layer-research/m5-repo-scan-preview.md`, the sections with the same names. The
other preview pipelines got their ideas through their own issue files. These two had no open issue to hang the link
on, because both pipelines are already built. This file turns every top idea and hardening note from those two
sections into a spec item. Rows that the code already covers stay in the table with the line that proves it.

## website-build

Steps today (`pipelines/website-build.json`): `design`, `build`, `critique` (loops up to 3), `preview`
(`plugin:deploy/preview`), `approve` (gate), `production` (`plugin:deploy/production`). Deploys go through
`plugins/deploy/bin/deploy.js`, which runs `vercel deploy`.

Several rows add checks to one new code step, `site-check` (`pipelines/website-build/site-check.mjs`), placed between
`preview` and `approve`. It fetches the preview URL and writes `{{run.dir}}/site-check.json`. Each problem it finds
becomes one line in the `approve` gate summary. It never fails the run; the person at the gate decides.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| WB-I1 | DESIGN.md as a typed content contract, from JohnSundell/Publish and jekyll/jekyll | `design` | The `design` prompt names fixed headings: Pages, Sections, Type, Colour, Content. A new code step `design-lint` (`pipelines/website-build/design-lint.mjs`) after `design` fails when any heading is missing or has no body, and names it | A fixture DESIGN.md with no Colour section fails `design-lint` with "missing section: Colour", and `build` never starts | 0.4 |
| WB-I2 | Page metadata checked against a schema before approval, from jnordberg/wintersmith, getpelican/pelican and decaporg/decap-cms | `site-check` | Creates `site-check`. For each page it fetches (WB-I4 crawl), it records a missing `<title>`, a missing `<meta name="description">`, or a title shared by two pages | A fixture site where two pages share a title and one has no description shows both lines in the `approve` summary | 0.4 |
| WB-I3 | Components from a typed registry, from chaibuilder/core and Shreyas-29/astra | `build` | Already true: `pipelines/website-build.json:15` attaches the shadcn assist to `build` | None | 0 |
| WB-I4 | Link check before the approve gate, from getzola/zola and jackyzha0/quartz | `site-check` | Crawls same-origin links from the preview home page, depth 2, at most 50 pages. A 4xx or 5xx internal link is a gate line. External links get a HEAD request with a 10 s timeout and are listed separately as "external, unchecked" when they time out | A fixture with one internal link to a missing page shows "broken link: /about -> 404" in the `approve` summary | 0.4 |
| WB-I5 | Sitemap and robots.txt checked before approval, from iamvishnusankar/next-sitemap and eudicots/Cactus | `site-check` | Fetches `/sitemap.xml` and `/robots.txt` on the preview. Either missing, or a sitemap that does not parse as XML, is a gate line | A fixture with no sitemap shows "no sitemap.xml" in the `approve` summary | 0.2 |

Worked: 0.4 + 0.4 + 0 + 0.4 + 0.2 = 1.4 CC days.

### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| WB-H1 | A missing required config value fails before the render, from jekyll/jekyll | new first step | Today a project that was never `vercel link`ed fails at `preview` (`plugins/deploy/bin/deploy.js:11`), after up to 180 minutes of `design`, `build` and `critique`. A code step `preflight` (`pipelines/website-build/preflight.mjs`) runs first: it fails when `.vercel/project.json` is missing from the project or `vercel --version` does not exit 0 | A fixture project with no `.vercel` folder fails at `preflight` with the `vercel link` message, and `design` never starts | 0.3 |
| WB-H2 | Stop at the first failed step instead of running on partial output, from metalsmith/metalsmith | all | Already true: a failed step fails the whole run through `fail()` in `core/src/pipelines/runner.ts:272-273` | None | 0 |
| WB-H3 | Relative assets and links resolve against the base URL, from jnordberg/wintersmith and eudicots/Cactus | `site-check` | On every page it fetches, `site-check` also requests each `img src`, `script src` and `link href` on the preview origin. A 404 is a gate line naming the page and the asset | A fixture page that references `/img/hero.png`, which the build never wrote, shows "missing asset: /img/hero.png on /" in the `approve` summary | 0.2 |
| WB-H4 | Two deploys never overlap, from peaceiris/actions-gh-pages | `preview`, `production` | `deploy.js` creates `.vercel/troop-deploy.lock` in the deploy folder with an exclusive create before it runs `vercel`, and removes it after. A lock older than 15 minutes counts as stale and is replaced. A second deploy that finds a live lock fails with "another deploy is running for this project" | Two `production` actions started together on a fixture, with `vercel` stubbed to sleep 2 s, give one success and one failure with that message | 0.3 |
| WB-H5 | Only an authorised person can approve production, from decaporg/decap-cms and Pythagora-io/ai-visual-website-builder | `approve` | Already true: `production` sits behind the `approve` gate (`pipelines/website-build.json:62-68`). Proof that another account cannot answer a gate is M1-10, a BLOCKER in `issues/m5-00-rebaseline.md` | None here | 0 |

Worked: 0.3 + 0 + 0.2 + 0.3 + 0 = 0.8 CC days.

website-build total: 1.4 + 0.8 = 2.2 CC days.

## design-variants

Steps today (`pipelines/design-variants.json`): `board` (`plugin:agent-reach/inspiration-board`), `directions`,
`approve-directions` (gate), `variants` (fanout 3, one worktree and dev server each), `pick` (handoff gate in the
variants grid), `polish`. The board returns text references only, no images
(`plugins/agent-reach/bin/inspiration-board.js:111-113`).

Several rows add checks to one new code step, `variant-check` (`pipelines/design-variants/variant-check.mjs`), placed
between `variants` and `pick`. It runs once per variant worktree and writes `{{run.dir}}/variant-check-<index>.json`.
Its counts show on each tile and in the `pick` gate summary. It never fails the run.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DV-I1 | Assemble from a component registry, not raw markup, from shadcn-ui/ui, creativetimofficial/ui, Jakubantalik/Libraries.dev and nraiden/openv0 | `variants` | When the project root has `components.json`, the `variants` prompt adds one line: add components with `npx shadcn add <name>` and do not hand-write one the registry has | The rendered `variants` prompt for a fixture with `components.json` contains that line, and for a fixture without it does not | 0.2 |
| DV-I2 | Turn references into numbers once and give all three directions the same list, from dembrandt/dembrandt, zanwei/design-dna, Manavarya09/design-extract and leigest519/ScreenCoder | new step after `board` | A code step `tokens` (`pipelines/design-variants/tokens.mjs`) fetches each reference URL through `plugins/agent-reach/bin/safe-fetch.js`, reads its inline and linked CSS, and writes `{{run.dir}}/tokens.json`: per reference, the 8 most used hex colours with counts, the font families, and the font sizes. The `directions` prompt reads that file. A reference that fails to fetch is listed as "not read", never guessed | A fixture page whose CSS uses `#111` five times, `#f5f5f5` three times and `#e11` once gives those three colours in that order in `tokens.json` | 0.6 |
| DV-I3 | One worktree per direction with its own dev server, from max-sixty/worktrunk | `variants` | Already true: `pipelines/design-variants.json:50-53` (fanout 3, `worktree`, `dev_command`), with a leased port per index in `core/src/pipelines/runner.ts:663` | None | 0 |
| DV-I4 | Lint each variant against design-system rules before the pick gate, from shadcn-ui/lint, Manavarya09/design-extract and plugin87/ux-ui-agent-skills | `variant-check` | Creates `variant-check`. On the lines the variant added (from `git diff` against its base), it counts raw hex colours and `px` values outside a tokens or theme file. For each CSS rule that sets both `color` and `background` to literal colours, it computes the WCAG contrast ratio and flags anything under 4.5 | A fixture variant with `color: #777; background: #fff` (ratio 4.48) is flagged with that ratio, and its tile shows "1 contrast" | 0.5 |
| DV-I5 | The reviewer clicks the region to change and its selector goes to polish, from benjitaylor/agentation, breschio/drawbridge and narnia-sh/layrr | `pick`, `polish` | The variants grid gains "Mark a region": a click on an element in the picked tile's preview records its CSS selector and a short note into `{{run.dir}}/pick-notes.json`. The `polish` prompt lists each selector with its note | On a fixture run, marking one element writes its selector to `pick-notes.json`, and the rendered `polish` prompt contains that selector | 1.0 |

Worked: 0.2 + 0.6 + 0 + 0.5 + 1.0 = 2.3 CC days.

### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DV-H1 | Parallel variants never collide on ports or env files, from max-sixty/worktrunk | `variants` | Ports are already separate: one lease per index (`core/src/pipelines/runner.ts:663`). Env files are not: `git worktree add` leaves out an untracked `.env` or `.env.local`, and the dev server only inherits the app's own environment (`core/src/pipelines/devserver.ts:50`). In `placeIndex` (`runner.ts:625`), after the worktree is made, copy untracked `.env` and `.env.local` from the project root into it, and set `PORT` to the leased port in the dev server's environment | A fixture project with `.env.local` holding `X=1` gives three variant worktrees that each hold the file, and each dev server sees `PORT` equal to its own leased port | 0.3 |
| DV-H2 | Invented components, icons or imports are caught before the pick gate, from nraiden/openv0, creativetimofficial/ui and shadcn-ui/ui | `variant-check` | When the worktree's `package.json` has a `build` script, `variant-check` runs `npm run build` there with a 300 s timeout. A non-zero exit marks the tile "does not build" with the last 20 lines of output | A fixture variant that imports a module that does not exist shows "does not build" on its tile and in the `pick` summary | 0.4 |
| DV-H3 | Placeholder images do not ship, from leigest519/ScreenCoder and abi/screenshot-to-code | `variant-check` | Flags any `img` whose `src` is empty, points at a placeholder host (placehold.co, via.placeholder.com, picsum.photos, dummyimage.com), or names a file missing from the worktree. Flag only; swapping in cropped assets waits until the board returns images | A fixture variant with `<img src="https://placehold.co/600x400">` shows "1 placeholder image" on its tile | 0.2 |
| DV-H4 | Long reference screenshots are tiled and capped before a model reads them, from JochenYang/luma-mcp and Anionex/agent-vision-toolkit | none today | Not applicable today: no step passes images to a model, because the board returns text references (`inspiration-board.js:111-113`). Becomes a spec item when a step starts sending reference images | None | 0 |
| DV-H5 | Polish must not break the layout, from abi/screenshot-to-code and Manavarya09/design-extract | `polish` | The `polish` prompt calls `screenshot` with `save_as` set to `before-1280` and `before-390` before any change, and `after-1280` and `after-390` at the end, the same way `critique` does in website-build. A code step `polish-diff` after `polish` runs odiff on each pair when `odiff` is installed. A pair that differs by more than 30% of its pixels is a line in the run's final summary. Without odiff it says "polish diff: odiff not installed" | On a fixture where polish is stubbed to delete the main section, the 1280 pair is reported above 30% | 0.4 |

Worked: 0.3 + 0.4 + 0.2 + 0 + 0.4 = 1.3 CC days.

design-variants total: 2.3 + 1.3 = 3.6 CC days.

All of M5-20: 2.2 + 3.6 = 5.8 CC days.

## Tests

Codex writes the tests. A test that needs a real external tool (vercel, odiff, npm) stubs it or skips with a printed
reason.
