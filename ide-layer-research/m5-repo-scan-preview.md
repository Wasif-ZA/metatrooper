# M5 repo scan: preview and unshipped pipelines

Written 2026-10-09. Each pipeline got four to twenty GitHub searches (`gh search repos --sort stars`); the
most starred candidates had their README read by the local model (gemma4:12b, no cloud tokens), then a Haiku
pass kept only the repos that do the pipeline's job or one of its steps' jobs, including tools a step could
call or copy. Nothing here is built before launch (M5-D11); it is the idea bank for each lane when it leaves
preview. For seven lanes (design-variants, deep-research-cited, data-to-dashboard, form-fill-batch,
prospect-list-to-drafts, inbox-triage-drafts, study-notes-to-pdf) the last pass was Sonnet judging about 300
search candidates each from their descriptions, reusing the README notes where they existed. The coding
built-ins have their own scan in `m5-hardening-coding.md`.

Where a lane has fewer than 40 relevant repos, the close-match space on GitHub ran out: the count is what
survived the relevance check, never padded.

| Pipeline | READMEs read | Relevant repos |
|---|---|---|
| website-build | 50 | 44 |
| design-variants | 190 | 41 |
| docs-and-release-notes | 50 | 42 |
| security-review-and-upgrade | 90 | 43 |
| footage-to-edit | 90 | 47 |
| clips-to-scheduled-posts | 50 | 45 |
| seo-audit-fix | 50 | 42 |
| deep-research-cited | 190 | 40 |
| data-to-dashboard | 124 | 41 |
| form-fill-batch | 90 | 41 |
| prospect-list-to-drafts | 190 | 40 |
| inbox-triage-drafts | 190 | 40 |
| study-notes-to-pdf | 90 | 39 |

## website-build

Relevant: 44 of 50 mined repos. Each row does a similar job to a step of this pipeline.

Dropped (off-topic or same job as another row): zhayujie/bot-on-anything, vuepress/core, estruyf/vscode-front-matter, vgulerianb/DocNavigator, Ronald106/Surviv.io, NextGenAILabs/GenAIMindMapFlowBuilder.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| jekyll/jekyll | 51707 | mit | Jekyll is a blog-aware static site generator that converts Markdown and Liquid templates into a... | design: typed front matter as content contract; build: config validation |
| vuejs/vuepress | 22723 | mit | VuePress is a minimalistic Vue-powered static site generator used to build documentation and... | build: Markdown-to-site pipeline; critique: visual checks on rendered pages |
| decaporg/decap-cms | 19423 | mit | Decap CMS is a Git-based content management system that allows users to manage and edit content for... | approve: restrict who can trigger production; design: schema-driven content model |
| vuejs/vitepress | 18392 | mit | VitePress is a Vue-powered static site generator that transforms Markdown content into... | build: Vite bundling keeps large builds fast; preview: multi-browser render check |
| getzola/zola | 17497 | eupl-1.2 | Zola is a high-performance static site generator that compiles content into a production-ready... | preview: internal and external link checks before approval |
| jackyzha0/quartz | 13362 | mit | Quartz is a static-site generator that transforms Markdown files into a functional website with... | design: linked-note content graph; preview: broken-link check |
| getpelican/pelican | 13352 | agpl-3.0 | Pelican is a Python-based static site generator that converts Markdown and reStructuredText into... | build: cache so only changed pages rebuild; critique: metadata validation |
| react-static/react-static | 10336 | mit | React-Static is a progressive static site generator that builds high-performance, SEO-friendly... | build: code and data splitting; preview: asset prefetch |
| metalsmith/metalsmith | 7819 | mit | Metalsmith is a pluggable static site generator that processes files through a chain of plugins to... | build: stop on any plugin error; preview: per-plugin debug trace |
| ppoffice/hexo-theme-icarus | 6642 | mit | highly customizable, feature-rich, and responsive theme for the Hexo static site generator | design: theme variants; build: per-page config overrides |
| zensical/zensical | 5867 | mit | Zensical is a modern static site generator that converts Markdown into professional, searchable,... | production: search index and navigation; preview: device-size checks |
| peaceiris/actions-gh-pages | 5364 | mit | GitHub Action to automate the deployment of static site files to GitHub Pages | production: deploy to a dedicated branch; production: token scopes and concurrency |
| JohnSundell/Publish | 4969 | mit | Publish is a static site generator for Swift that uses a type-safe, step-based pipeline to... | design: type-safe metadata schema; build: discrete testable steps |
| dotnet/docfx | 4447 | mit | Docfx is a static site generator that transforms .NET source code, Markdown files, and other inputs... | preview: snapshot tests for layout regressions; production: separate build profiles |
| Jack000/Expose | 4437 | mit | Expose is a Bash-based static site generator that transforms folders of images and videos into... | build: normalise images and video; skip files with _ prefix |
| assemble/assemble | 4255 | mit | Assemble is a command-line tool and developer framework for rapid prototyping, static site... | build: plugin-driven static generation for prototypes |
| umijs/dumi | 3800 | mit | dumi is a static site generator specifically designed for building documentation and websites for... | build: generated component docs; preview: component preview page |
| iamvishnusankar/next-sitemap | 3746 | mit | tool to automatically generate sitemaps and robots.txt files for Next.js applications based on... | build: sitemap and robots generation; preview: robots.txt validation |
| observablehq/framework | 3660 | isc | Observable Framework is a static site generator that combines front-end JavaScript for... | build: precompute data snapshots so production is static |
| jnordberg/wintersmith | 3476 | mit | Wintersmith is a flexible static site generator that transforms content (markdown, etc.) into a... | build: validate metadata before render; preview: resolve asset paths against base URL |
| eudicots/Cactus | 3466 | bsd-3-clause | Cactus is a static site generator that uses Django templates and an asset pipeline to transform... | build: asset fingerprinting for cache busting; preview: sitemap and robots.txt |
| scullyio/scully | 2527 | mit | Scully is a static site generator for Angular apps that pre-renders pages into plain HTML/CSS to... | build: pre-render routes to static HTML; design: map every route first |
| web-infra-dev/rspress | 2344 | mit | Rspress is a high-performance static site generator based on Rsbuild and MDX for building... | build: plugin hooks; build: bundle-size monitoring |
| lumeland/lume | 2284 | mit | Lume is a high-performance, flexible static site generator for Deno that supports multiple file... | build: check minified and bundled assets; design: minimal dependencies |
| twostraws/Ignite | 2271 | mit | Ignite is a static site generator for Swift developers that uses a SwiftUI-like DSL to build... | design: must-have layout check; preview: local server before production |
| Mobirise/Mobirise | 982 | none listed | Mobirise is an AI-powered website builder that allows users to create, customize, and publish... | build: regenerate one section without restart; build: image optimisation |
| chaibuilder/core | 483 | bsd-3-clause | ChaiBuilder Core is an AI-enabled visual website builder for Next.js that provides a block-based... | build: typed component registry; preview: draft banner so staging never leaks |
| Shreyas-29/astra | 289 | cc0-1.0 | Astra is a modern, responsive landing page built with Next.js, TailwindCSS, and Shadcn UI,... | build: shadcn-style UI blocks; critique: responsive breakpoint check |
| Ratna-Babu/Ai-Website-Builder | 206 | none listed | AI-powered platform that transforms natural language prompts into functional React/Tailwind... | preview: live preview before approval; critique: validate generated code |
| MartinsMessias/deepsite-locally | 203 | none listed | DeepSite is an AI-powered website builder that allows users to generate and host websites locally... | build: schema validation of generated data; preview: local dev server |
| playcode/playcode-desktop | 145 | gpl-3.0 | legacy desktop client for an AI-powered website and app builder that generates live sites from... | design: plain-English intent to plan; production: one-click publish |
| thewebalchemist/ai-builder | 144 | none listed | LLMs to automatically generate responsive landing pages using HTML, CSS, and Tailwind based on... | design: component choice by business type; preview: mobile and desktop check |
| playcode/playcode | 140 | none listed | Playcode is an AI-powered platform that generates, hosts, and allows for the visual editing of... | critique: visual editing of layout and colour; production: custom domain and SSL |
| desyed/likho | 119 | mit | LIKHO is an AI-powered, multi-tenant website builder that uses a Notion-style WYSIWYG editor to... | build: structured content blocks; production: tenant isolation |
| buildingopen/openpage | 93 | mit | OpenPage is a JSON-first website builder that provides a structured, agent-friendly intermediate... | build: JSON intermediate schema validated before preview; production: standalone export |
| builtbyV/ai-website-builder | 83 | mit | A multi-agent compatible framework that allows users to build and update websites using natural... | build: rollback command when generated code breaks; design: reusable skill prompts |
| gochapachi/Autonomous-AI-Website-Builder-n8n-Coolify-Wordpress-Gemini-3- | 79 | none listed | automated pipeline to deploy, design, and populate a WordPress site using n8n, Coolify, and Gemini | design: sitemap plan before generation; build: one shared layout |
| HamzaAmir97/saas_ai_website_builder | 40 | mit | AI-powered platform that allows users to build, preview, and manage websites through a... | preview: sandboxed container render; design: persistent project state |
| Pythagora-io/ai-visual-website-builder | 33 | mit | PythaPress is a web application that allows users to build and customize websites using natural... | preview: split-screen live preview; approve: authenticated approval |
| BuildingTechAlternatives/OpenThorn | 26 | none listed | OpenThorn is a BYOK AI website builder that allows users to generate, preview in-browser, and... | preview: in-browser bundling for instant preview |
| arham2211/aura | 25 | none listed | Aura is an AI-powered platform that uses autonomous agents and sandboxed environments to generate,... | build: sandboxed generation environment |
| hi-Kartik2004/CraftFolio | 24 | none listed | CraftFolio is an AI-powered portfolio builder that allows users to customize personal websites via... | design: all content in one data file the agent edits |
| soapbox-pub/shakespeare | 23 | agpl-3.0 | Shakespeare is a browser-based AI app builder that allows users to build, manage, and deploy web... | build: browser-based build and deploy loop |
| sanidhyy/lovable-clone | 23 | mit | AI-powered application builder that allows users to create websites and apps via chat, utilizing a... | build: chat-driven generation in a sandbox |

### Top ideas

1. design: write DESIGN.md as a typed content contract (sections, copy, type scale) before any build. Sources: JohnSundell/Publish, jekyll/jekyll.
2. build: validate each page's metadata against a schema before rendering. Sources: jnordberg/wintersmith, getpelican/pelican, decaporg/decap-cms.
3. build: take components from a typed registry instead of hand-writing them. Sources: chaibuilder/core, Shreyas-29/astra.
4. preview: check internal and external links before the approve gate. Sources: getzola/zola, jackyzha0/quartz.
5. preview: generate and validate sitemap and robots.txt before approval. Sources: iamvishnusankar/next-sitemap, eudicots/Cactus.

### Hardening

1. build: failure mode, a required config value is missing and the render writes broken pages. Handle by failing before render. Source: jekyll/jekyll.
2. build: failure mode, one plugin errors and the rest of the chain runs on partial output. Handle by stopping at the first failed step. Source: metalsmith/metalsmith.
3. preview: failure mode, relative assets or links resolve wrongly and break in production. Handle by resolving every path against the base URL. Sources: jnordberg/wintersmith, eudicots/Cactus (fingerprinting).
4. production: failure mode, two deploys overlap on the target branch. Handle with concurrency control. Source: peaceiris/actions-gh-pages.
5. approve: failure mode, an unauthorised user triggers production. Handle by requiring an authenticated, authorised approver. Sources: decaporg/decap-cms, Pythagora-io/ai-visual-website-builder.

## design-variants

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| abi/screenshot-to-code | 80,109 | mit | screenshot, mockup or video to HTML/Tailwind/React via several models | variants (model fallback, asset reuse), polish (pixel check) |
| onlook-dev/onlook | 26,891 | apache-2.0 | visual editor mapping UI elements to Next.js/Tailwind source, AI edits | variants (element-to-source map), polish |
| shadcn-ui/ui | 125,186 | mit | copy-in component registry with accessible defaults | variants (assemble from registry, not raw markup) |
| magicuidesign/magicui | 22,521 | mit | copy-paste animated components and effects | variants (animated blocks) |
| ibelick/motion-primitives | 6,495 | mit | animated UI primitives for React | variants (motion parts) |
| seek-oss/playroom | 4,598 | mit | design with JSX against your own component library, many frames side by side | variants, pick (side-by-side frames) |
| DouyinFE/semi-design | 10,406 | other | React design system with tokens and a design-to-code flow | variants (component source), polish (a11y) |
| grab/cursor-talk-to-figma-mcp | 7,047 | mit | MCP bridge that reads and writes Figma frames | directions (Figma input), polish (batch text edits) |
| GLips/Figma-Context-MCP | 15,966 | mit | trims Figma API data to layout and style facts for agents | directions (Figma context) |
| southleft/figma-console-mcp | 2,454 | mit | two-way Figma API: extract, create and audit components | board (design-code parity), polish (WCAG pass) |
| awdr74100/figwright | 995 | mit | two-way Figma MCP, design to framework-aware code and back | variants (code push back to design) |
| ZSeven-W/openpencil | 6,105 | mit | AI vector design tool, JSON design files, parallel agent teams | variants (structured file, parallel parts) |
| leigest519/ScreenCoder | 3,005 | apache-2.0 | multi-agent screenshot to HTML/CSS: detect, map, generate | board (region detection), variants (layout map) |
| Anionex/agent-vision-toolkit | 1,218 | mit | vision tools for text-only models: UI restoration, long-screenshot OCR | board, variants (intent-aware read), polish |
| mostafasadeghi97/design2code | 683 | mit | design screenshot to responsive HTML/CSS/JS | variants |
| Flame-Code-VLM/Flame-Code-VLM | 561 | apache-2.0 | mockup to modular React via a vision-language pipeline | variants, pick (functional tests) |
| narnia-sh/layrr | 267 | mit | maps a clicked browser element to its source file and line | polish (targeted edits) |
| s-smits/ui-screenshot-to-prompt | 236 | none listed | screenshot to implementation prompt via OCR, OpenCV, LLM | board (region slicing) |
| JochenYang/luma-mcp | 116 | mit | vision MCP: OCR and UI analysis for text-only models | variants (tile large images), polish |
| Leonxlnx/taste-skill | 93,941 | mit | agent skills enforcing type, spacing and motion rules against generic output | board (design-system map), polish (redesign audit) |
| creativetimofficial/ui | 12,076 | mit | shadcn-based component and block library | variants (block source) |
| max-sixty/worktrunk | 9,071 | other | CLI for git worktrees with hooks, built for parallel agents | variants (one worktree and server per direction) |
| superdesigndev/superdesign | 7,077 | other | AI design agent making mockups and components from prompts in the IDE | variants (option count, preview) |
| bernaferrari/FigmaToCode | 5,217 | gpl-3.0 | deterministic Figma to HTML/Tailwind/Flutter converter, flags ambiguous nodes | variants (rule-based output), pick (warnings) |
| benjitaylor/agentation | 4,904 | other | click-to-annotate UI feedback emitting selectors and positions for agents | pick (structured notes), polish |
| breschio/drawbridge | 969 | other | browser design editor: click an element, comment, send to Claude Code or Cursor | pick (region comments), polish |
| Manavarya09/design-extract | 4,190 | mit | extracts tokens, layout, motion and voice from a live site | board (reference tokens), polish (contrast, drift check) |
| dembrandt/dembrandt | 3,619 | mit | extracts a site's design system (colours, type, spacing) into tokens | board (reference tokens) |
| zanwei/design-dna | 1,917 | mit | turns reference UIs into quantified Design DNA JSON | board (numbers per reference), directions |
| Railly/tinte | 624 | mit | compiles a reference identity into an agent plugin of tokens and rules | directions (identity file the variants obey) |
| Jakubantalik/Libraries.dev | 4,146 | mit | copy-paste UI parts for agents with parameter prompts | variants (component prompts) |
| nraiden/openv0 | 3,955 | mit | multi-pass generative UI constrained to a component library | variants (library-constrained), polish (repeat passes) |
| JimLiu/baoyu-design | 4,269 | mit | design-engine skill with starter components and preview-verify loop | variants (starter primitives), polish (verify loop) |
| shadcn-ui/lint | 3,141 | mit | agent-first linter for Tailwind design-system rules with fix messages | polish (auto-fix), variants (contracts) |
| plugin87/ux-ui-agent-skills | 1,558 | mit | agent skills: DTCG tokens, 52 components, WCAG 2.2 checks | directions (token format), polish (WCAG) |
| carmahhawwari/ui-design-brain | 893 | other | skill giving agents component best practice per UI part | directions, variants |
| AnxForever/stylekit | 589 | mit | 148 curated visual styles with design tokens for AI-generated UI | directions (named style palette) |
| hamen/material-3-skill | 1,457 | mit | Material Design 3 skill: 30+ components, tokens, theming | variants (one direction on a real system) |
| IncomeStreamSurfer/AI-DESIGN-BENCHMARK | 35 | none listed | generates a UI component with several models and compares outputs | pick (model compare view) |
| spatie/browsershot | 5,248 | mit | HTML to image or PDF through headless Chrome | board (reference renders), pick (thumbnails) |
| design-tokens/community-group | 2,144 | other | the DTCG design-token file format spec | directions (one token format for all three) |

Dropped notable (not relevant): shadcn-ui/ui peers (twbs/bootstrap, mui/material-ui, tailwindlabs/tailwindcss, mantinedev/mantine: libraries, not pipelines), emilwallner/Screenshot-to-code (2024 research code), intergalacticspacehighway/codesnap (macOS app), Mrxyy/screenshot-to-page, gridaco/assistant, terrazzoapp/terrazzo, southleft/story-ui, Owl-Listener/designer-skills, vercel/satori, bubkoo/html-to-image, 20+ small visual-regression repos (eliBenven/visual-qa-agent, lintlab/visual-regression-action; odiff already covers the diff step)

### Top ideas

1. **variants**: Give each direction a component registry to assemble from, not raw markup. Source: shadcn-ui/ui, creativetimofficial/ui, Jakubantalik/Libraries.dev, nraiden/openv0.
2. **board**: Turn each reference into numbers (colours, type scale, spacing) and detect its regions once, then hand the same list to all three directions. Source: dembrandt/dembrandt, zanwei/design-dna, Manavarya09/design-extract, leigest519/ScreenCoder.
3. **variants**: One worktree per direction, with hooks that install and start its own dev server. Source: max-sixty/worktrunk.
4. **polish**: Lint the picked variant against design-system rules before the pick gate: no arbitrary hex or px, contrast scored. Source: shadcn-ui/lint, Manavarya09/design-extract, plugin87/ux-ui-agent-skills.
5. **pick**: Let the reviewer click the exact region to change and send its selector to polish, not prose. Source: benjitaylor/agentation, breschio/drawbridge, narnia-sh/layrr.

### Hardening

1. **variants**: Parallel variants collide on ports and env files. Give each worktree its own port and env. Source: max-sixty/worktrunk.
2. **variants**: The model invents components, icons or imports that do not exist. Check every import against the registry and build before the pick gate. Source: nraiden/openv0, creativetimofficial/ui, shadcn-ui/ui.
3. **variants**: Placeholder or missing images in the reference ship as placeholders. Detect them and swap in cropped assets. Source: leigest519/ScreenCoder, abi/screenshot-to-code.
4. **variants**: Long reference screenshots exceed model input and truncate. Tile with overlap and cap resolution first. Source: JochenYang/luma-mcp, Anionex/agent-vision-toolkit.
5. **polish**: The polish pass breaks layout or drops hover and active states. Compare before and after renders and check interactive states. Source: abi/screenshot-to-code, Manavarya09/design-extract.

## docs-and-release-notes

Relevant: 42 of 50 mined repos. Each row does a similar job to a step of this pipeline.

Dropped (off-topic or same job as another row): kac89/vulnrepo, linkp2p/WPS-PIN, Ronald106/Surviv.io, YounesBensafia/DevLens, mercedes-benz/gitflow-cli, robsonnatanael/automatic-versioning-guide, constantine2003/Morph.ai, mzored/init-deep.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| semantic-release/semantic-release | 24097 | mit | fully automated tool for versioning, generating release notes, and publishing packages based on... | release: conformity checks before publish; changelog: notes from commit history |
| orhun/git-cliff | 12292 | apache-2.0 | git-cliff is a highly customizable tool that generates changelogs from Git history using... | changelog: regex parsers for commit categories |
| github-changelog-generator/github-changelog-generator | 7539 | mit | tool to automatically generate a CHANGELOG.md file by fetching and formatting data from GitHub... | changelog: group PRs and issues by label |
| lerna/lerna-changelog | 801 | mit | PR-based changelog generator that automatically categorizes and formats GitHub pull requests into a... | changelog: categorise PRs by label; changelog: cache API responses |
| algolia/shipjs | 776 | mit | Ship.js is a tool that automates the release process by creating a draft pull request for... | approve: release as a draft PR for review; release: run in clean CI |
| qoomon/git-conventional-commits | 645 | gpl-3.0 | CLI tool to enforce Conventional Commit standards, automate semantic versioning, and generate... | changelog: detect breaking changes from ! or BREAKING CHANGE |
| frinyvonnick/gitmoji-changelog | 395 | mit | tool to automatically generate changelogs based on gitmoji commit conventions | changelog: gitmoji categories as fallback |
| semantic-release/release-notes-generator | 369 | mit | plugin for semantic-release to automatically generate structured release notes from commit history... | changelog: conventional-commits presets |
| rafinskipg/git-changelog | 355 | mit | tool to automatically generate a structured CHANGELOG.md file by parsing git commit history based... | changelog: config file of regex categories |
| orhun/git-cliff-action | 214 | apache-2.0 | GitHub Action to automatically generate a changelog from Git history using the git-cliff tool | diff: fetch full history (fetch-depth 0) in CI |
| maintainer-org/maintainer | 209 | apache-2.0 | Maintainer is a CLI tool that automates the generation of standard repository documentation like... | update: standard repo docs from history |
| pawamoy/git-changelog | 185 | isc | tool to automatically generate changelogs from git logs using Jinja2 templates and various commit... | changelog: Jinja2 templates; release: SemVer and PEP 440 |
| antham/chyle | 164 | mit | Chyle is a tool that generates changelogs by extracting data from git commits and enriching it with... | changelog: enrich entries from external sources |
| metcalfc/changelog-generator | 149 | mit | GitHub Action to generate markdown-formatted changelogs between two git references based on commit... | changelog: markdown between two git refs |
| axetroy/vscode-changelog-generator | 144 | mit | VS Code extension to automatically generate changelogs based on code changes | map: changes from code diff |
| spring-io/github-changelog-generator | 117 | apache-2.0 | tool to automatically generate markdown changelogs from GitHub issues and pull requests based on... | changelog: markdown from issues and PRs |
| rhysd/changelog-from-release | 111 | mit | command-line tool that automatically generates a Markdown changelog by fetching and processing... | changelog: built from GitHub release bodies |
| jwage/changelog-generator | 103 | mit | tool to automatically generate markdown changelogs by fetching and formatting GitHub milestones,... | changelog: markdown from GitHub PRs |
| Vivek-736/Repo-Mind | 87 | mit | RepoMind is an AI-powered platform that analyzes codebases to generate architectural documentation,... | map: architecture doc from codebase |
| yoshuawuyts/changelog | 86 | apache-2.0 | CLI tool to automatically generate changelogs by analyzing project history without requiring strict... | changelog: history without a remote |
| logchange/logchange | 73 | apache-2.0 | logchange is a tool that manages CHANGELOG.md by storing individual changes in separate YAML files... | changelog: one YAML file per change, no merge conflicts |
| anchore/chronicle | 65 | apache-2.0 | A CLI tool that automatically generates changelogs by analyzing GitHub PRs and Issues, categorizing... | changelog: PRs and issues categorised by label |
| release-lab/whatchanged | 56 | other | A CLI tool and library that generates structured changelogs based on the Conventional Commits... | changelog: Conventional Commits structure |
| favware/cliff-jumper | 56 | mit | A CLI tool that automates semantic versioning, changelog generation via git-cliff, and GitHub... | release: semver bump, git-cliff changelog, release tag |
| jonverrier/AgentDoc | 55 | none listed | AgentDoc is an MCP-based tool that automatically generates hierarchical C4 architecture diagrams... | map: C4 diagrams and summaries from code |
| jaywcjlove/changelog-generator | 47 | mit | GitHub Action that automatically generates a markdown-formatted changelog by comparing differences... | changelog: GitHub Action comparing two refs |
| ansible-community/antsibull-changelog | 45 | gpl-3.0 | specialized tool for generating structured changelogs for Ansible-related projects by parsing... | changelog: fragments per change |
| spyder-ide/loghub | 43 | mit | Loghub is a CLI tool that generates automated changelogs by fetching and filtering GitHub issues... | changelog: GitHub issues filtered for release |
| bb-boy680/open-zread | 42 | mit | An AI-powered multi-agent system that uses tree-sitter AST parsing and a three-layer repo map to... | update: AST-based repo map feeding doc generation |
| enormora/pr-log | 38 | mit | tool and library to automatically generate changelogs by processing GitHub pull requests and... | changelog: from pull requests |
| AOEpeople/semanticore | 23 | mit | Semanticore is a tool that automates changelog generation and version tagging based on Conventional... | release: version tag from Conventional Commits |
| gitex-flow/gitex-flow-node | 18 | mit | git-flow extension that automates versioning, changelog generation, and release management using... | release: git-flow version and changelog |
| lekterable/perfekt | 17 | mit | perfekt is a release, changelog, and versioning manager that automates versioning based on... | release: version bump from commit types |
| Jai0401/docSmith | 16 | mit | docSmith is an AI-powered tool that uses LLMs (via OpenRouter) to automatically generate... | update: LLM doc generation |
| standard-release/app | 13 | apache-2.0 | A GitHub App that automates the creation of GitHub Releases based on Conventional Commits and... | release: GitHub Release from Conventional Commits |
| iampawan/docsminddraft | 10 | mit | An AI-powered CLI tool that automatically generates structured documentation for codebases by... | map: docs from git change history |
| andyhtran/deepwiki-by-cc | 9 | mit | DeepWiki is an agentic wiki generator that uses Claude or Codex to crawl codebases, follow imports,... | update: wiki generated by crawling imports |
| yehezkieldio/firefly | 9 | mit | Firefly is a CLI tool that automates semantic versioning, changelog generation via git-cliff, and... | release: semver, changelog, GitHub release |
| EltonAugusto/ai-powered-release-notes-generator | 8 | none listed | automates the retrieval of JIRA issues, organizes them by category (epic/assignee), and generates... | changelog: release notes from tracker issues by category |
| kedar49/lazydocs | 6 | mit | LazyDocs is an AI-powered CLI tool that automates the generation of READMEs, PR descriptions, and... | update: README, PR description and changelog generation |
| azatuni/sem-ver-sh | 6 | none listed | bash script to automate Semantic Versioning (SemVer) by analyzing Conventional Commits to determine... | release: semver from Conventional Commits |
| taj54/universal-version-bump | 6 | mit | A GitHub Action that automatically detects and updates version numbers across various programming... | release: bump versions across manifests |

### Top ideas

1. changelog: group entries by commit type with configurable regex parsers. Sources: orhun/git-cliff, rafinskipg/git-changelog.
2. changelog: build entries from merged PR titles and labels. Sources: github-changelog-generator/github-changelog-generator, lerna/lerna-changelog.
3. changelog: one YAML file per change, so parallel PRs do not conflict. Source: logchange/logchange.
4. approve: release as a draft PR a reviewer edits before tagging. Source: algolia/shipjs.
5. release: conformity checks before publish. Source: semantic-release/semantic-release.

### Hardening

1. diff: failure mode, CI checks out a shallow clone and the range is empty. Handle with full history (fetch-depth 0). Source: orhun/git-cliff-action.
2. changelog: failure mode, regenerating overwrites hand-written history. Handle by merging into the existing file. Source: github-changelog-generator/github-changelog-generator (base merge).
3. changelog: failure mode, a breaking change is missed. Handle by detecting ! or BREAKING CHANGE. Source: qoomon/git-conventional-commits.
4. changelog: failure mode, API rate limits stop the run. Handle by caching responses. Source: lerna/lerna-changelog.
5. release: failure mode, a tag is cut from a laptop with local changes. Handle by running tag and publish in clean CI. Source: algolia/shipjs.

## security-review-and-upgrade

Relevant: 43 of 90.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| anthropics/claude-code-security-review | 6324 | mit | Claude-based semantic review of code changes for injection, auth and data exposure | plan (review), check (false-positive filter) |
| lunasec-io/lunasec | 1470 | other | Supply-chain monitor that opens PRs for vulnerable dependencies | inventory, bump |
| ShiftLeftSecurity/sast-scan | 882 | apache-2.0 | Multi-scanner SAST for code, IaC and containers, with SARIF output | inventory, check (build breaker), fix (baseline) |
| arm/metis | 875 | apache-2.0 | Agentic LLM security review with deterministic evidence collection | notes, plan, check |
| MobSF/mobsfscan | 793 | lgpl-3.0 | Semgrep-based SAST rules for Android and iOS source | check |
| OWASP/cve-lite-cli | 760 | mit | Lockfile vulnerability scan with fix commands and a local advisory DB | inventory (offline DB), plan (override hygiene), bump (pin fixes) |
| insidersec/insider | 555 | mit | SAST across Java, Kotlin, Swift, C#, JS against OWASP Top 10 | inventory, check (threshold) |
| openqodex/openqodex | 468 | apache-2.0 | Second agent verifies scanner findings on changed lines | check (reviewer pass) |
| project-codeguard/rules | 424 | other | Secure-by-default rulesets, translators and validators for AI coding | notes (rules), check (validators) |
| enlightn/security-checker | 339 | mit | PHP dependency scan against the Security Advisories DB | inventory, check (JSON output) |
| antgroup/YASA-Engine | 326 | apache-2.0 | Multi-language taint and data-flow analysis on a unified IR | notes (data flow), check (regression on known cases) |
| Orange-Cyberdefense/grepmarx | 279 | mit | SAST and SCA for many languages | inventory (LOC), plan (rule packs) |
| Feysh-Group/corax-community | 255 | lgpl-2.1 | Java static analysis with abstract interpretation | check (SARIF), inventory (rule checker) |
| nyudenkov/pysentry | 252 | mit | Python dependency scanner over lock files, with malicious-package checks | inventory (quarantine check, lock formats), notes (direct vs transitive) |
| ohaswin/pyscan | 251 | mit | Rust scanner for Python deps against OSV, with reachability ideas | inventory, check (reachability) |
| ParzivalHack/PySpector | 151 | apache-2.0 | Graph-based SAST with inter-procedural taint for Python | check (flow-sensitive) |
| shivasurya/code-pathfinder | 142 | apache-2.0 | Cross-file taint analysis, with sanitizer checks | inventory, fix (sanitizer validation) |
| Armur-Ai/vibescan | 89 | mit | Orchestrates scanners for AI-generated code, incl. hallucinated dependencies | inventory (risky deps), check (placeholder secrets) |
| dennisdoomen/packageguard | 80 | mit | NuGet and npm risk scoring, policy gates, licence checks, SBOM | approve-upgrade (risk gate), licences, notes (explain) |
| xeloxa/temodar-agent | 62 | apache-2.0 | Semgrep plus multi-agent LLM triage | check, fix (loop detection) |
| KnockOutEZ/diffdeck | 50 | other | Diff analysis with secret scanning and report output | inventory (secrets), plan (reports) |
| lambdasec/frame | 42 | apache-2.0 | Taint analysis with Z3 proof, plus LLM fix loop | check (reachability proof), fix (re-scan loop) |
| raye-deng/open-code-review | 40 | other | CI gate for hallucinated imports, stale APIs and security anti-patterns | inventory (registry check), check (stale APIs) |
| dependency-check/DependencyCheck | 7719 | apache-2.0 | OWASP SCA: CVEs by CPE, with NVD caching | inventory, licences, fix (purge stale DB) |
| google/mantis | 2392 | apache-2.0 | Agent that reproduces, verifies and patches vulnerabilities | check (reproduce first), fix (adversarial verify loop) |
| pyupio/safety | 2000 | none listed | Python dependency scan with malicious-package detection and fix advice | inventory (typosquat), bump (safe nearest version) |
| murphysecurity/murphysec | 1753 | apache-2.0 | SCA for Java, JS and Go, incl. transitive deps | inventory (transitive), fix (upgrade paths) |
| pypa/pip-audit | 1380 | apache-2.0 | Python environment audit with fix mode and CycloneDX output | bump (fix flag), plan (dry run), inventory (SBOM) |
| vigolium/vigolium | 1113 | other | Scanner with native and agentic scan, plus source audit for fixes | plan (agentic select), fix (source audit), check (OAST, auth roles) |
| fossology/fossology | 1033 | gpl-2.0 | Licence and copyright scanning and reporting | licences |
| tern-tools/tern | 1024 | bsd-2-clause | SBOM for container images and Dockerfiles | inventory, check (SPDX, CycloneDX) |
| visma-prodsec/confused | 790 | mit | Finds internal package names that public registries do not reserve | inventory, check (namespace) |
| ossillate-inc/packj | 694 | agpl-3.0 | Flags risky packages by metadata and install-time behaviour | inventory, check (dynamic), fix (sandboxed install) |
| google/osv-scalibr | 649 | apache-2.0 | SCA inventory, vulnerability detection and guided remediation | inventory (multi-type), fix (guided remediation) |
| codexstar69/bug-hunter | 519 | mit | Adversarial audit skill with evidence-based fixes | plan (skeptic phase), check (hybrid verify) |
| kulkarnirohit123/cra-agent | 455 | apache-2.0 | Scan, LLM triage, fix PRs, suppression store | check (suppressions), fix (PR generation) |
| CycloneDX/cyclonedx-python | 393 | apache-2.0 | Python SBOM generation | inventory (SBOM), bump (pre and post SBOM diff) |
| dependency-check/dependency-check-gradle | 386 | apache-2.0 | Gradle plugin for CVE scanning with CVSS thresholds | check (fail threshold), inventory (multi-module) |
| vulnersCom/api | 376 | mit | SDK for vulnerability intel, incl. licence metadata | check, licences (verify licence), fix (retry on rate limit) |
| filllabs/dependi | 269 | none listed | Multi-language dependency vulnerability tracking | inventory (more managers), licences (incompatible flags) |
| AgentSecOps/SecOpsAgentKit | 220 | other | 25+ SAST, DAST, SCA and compliance skills | bump (SAST on new deps), licences (SCA plus licence), approve-upgrade (policy) |
| aboutcode-org/scancode.io | 217 | apache-2.0 | SCA for licences, copyrights and vulnerabilities across package formats | licences, inventory |
| anchore/grant | 192 | apache-2.0 | Licence policy allow and deny lists for images, SBOMs and filesystems | licences (policy), check (JSON output) |

Dropped (47): Cyber-Buddy/APKHunt, Commando-X/vuln-bank, FradSer/dotclaude, adshao/flounder, Nayjest/Gito, nth5693/gemini-kit, TheMorpheus407/RepoLens, Sfedfcv/redesigned-pancake, node9-ai/node9-proxy, ossf-cve-benchmark/ossf-cve-benchmark, AlexZio00/sovereign-skills, ChuprinaDaria/Vibecode-Cleaner-Fartrun, ultralytics/actions, Houseofmvps/ultraship, microsoft/PromptKit, hyperb1iss/lucidity-mcp, UncertaintyArchitectureGroup/The-Subprime-Code-Crisis, YuxiaoWang-520/harness-craft, htrgouvea/zarn, GhostTroops/AiCSA, ScanLineDev/scanline, rjmurillo/ai-agents, TheAstrelo/Claude-Pipeline, anthroos/claude-code-review-skill, KingOfBugbounty/Dependency-Confusion-Hunter, dmdhrumilmistry/security-harness, hiteshsuthar01/OK-, NVIDIA/SkillSpector, 0x4m4/hexstrike-ai, Tencent/AI-Infra-Guard, Kritt-ai/open-kritt, msoedov/agentic_security, affaan-m/agentshield, xalgorix/xalgorix, raroque/vibe-security-skill, nealbridges/VulnHunter, boostsecurityio/poutine, AISecurityLab/hackagent, Unclecheng-li/DeepSec, SHAdd0WTAka/Zen-Ai-Pentest, ZeroDayEvil/ai-security-tool, agamm/claude-code-owasp, Yeti-791/Awesome-Offensive-AI-Agentic-Landscape, CyberSunil/LLMVault, tiiuae/sbomnix, sjkim1127/Reversecore_MCP, precize/Agentic-AI-Top10-Vulnerability

### Top ideas

1. **inventory and plan**: Check each new dependency for dependency confusion and typosquats before the bump. Source: visma-prodsec/confused (internal names), ossillate-inc/packj (risky packages), pyupio/safety (typosquat).
2. **check**: Baseline the existing findings and fail the run only on new ones, so the fix step is not pulled into old debt. Source: ShiftLeftSecurity/sast-scan (results baseline), kulkarnirohit123/cra-agent (suppression store), openqodex (suppression of reviewed findings).
3. **bump and check**: Diff the SBOM before and after the upgrade and fail on any dependency that appeared unexpectedly. Source: CycloneDX/cyclonedx-python (pre and post SBOM), tern-tools/tern (SBOM output).
4. **licences**: Enforce allow and deny lists, and treat weak and strong copyleft differently, as a hard check at the approve-upgrade gate. Source: anchore/grant (policy), dennisdoomen/packageguard (risk gate), aboutcode-org/scancode.io.
5. **plan and bump**: Run the upgrade as a dry run first, and pin fixed versions rather than moving tags. Source: pypa/pip-audit (--dry-run, --fix), OWASP/cve-lite-cli (fix commands, pinned versions, override pruning).

### Hardening

1. **inventory**: Transitive dependencies and lock-file formats get missed, so the plan works from an incomplete list. Source: murphysecurity/murphysec (transitive), google/osv-scalibr (multi-type extraction), nyudenkov/pysentry (uv, poetry and pipfile).
2. **check**: Scanner findings are false positives or unreachable, and the fix step wastes effort on them. Source: ohaswin/pyscan (reachability), openqodex (reviewer verifies findings), lambdasec/frame (symbolic reachability proof).
3. **fix**: A patch compiles and tests pass but the vulnerability is still there. Re-run the scanner or a reproduction test after the patch. Source: lambdasec/frame (re-scan loop), google/mantis (adversarial verify), shivasurya/code-pathfinder (sanitizer check).
4. **bump and fix**: The agent pulls in a hallucinated or risky package, or loops forever. Verify each new package exists in the registry and cap the loop. Source: raye-deng/open-code-review (registry check), Armur-Ai/vibescan (hallucinated dependencies), xeloxa/temodar-agent (loop detection).
5. **inventory and check**: The scanner fails on code that does not build, or runs out of memory on large repos, and the run silently skips it. Source: Feysh-Group/corax-community (incomplete build guard, OOM guard), Orange-Cyberdefense/grepmarx (scan code that does not compile), dependency-check/DependencyCheck (purge stale DB after major upgrades).

## footage-to-edit

Relevant: 47 of 90.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| WyattBlue/auto-editor | 5459 | unlicense | CLI that cuts silence and dead space from video and audio | edit (silence cut, margin), visual-check (discarded preview) |
| FireRedTeam/FireRed-OpenStoryline | 3471 | apache-2.0 | AI editing agent: script, asset selection, multi-modal edit | transcribe (filler removal), plan |
| OpenShot/openshot-qt | 6605 | other | Open-source NLE with multi-track, transitions and effects | edit (keyframes, time-mapping), visual-check (frame accuracy) |
| MartinDelophy/ai-video-editor | 907 | mit | Browser timeline editor with local AI captions and voiceover | edit, approve-final (deterministic export) |
| JimLiu/baocut | 533 | other | Shared human and agent timeline with transcription and motion graphics | edit (persistent project state), visual-check (honest status) |
| open-ribbi/velocut | 456 | mit | Local editor driven by a shared JSON command protocol | edit (atomic ops, revisions), visual-check (frame grabs) |
| RafaelGodoyEbert/ViralCutter | 420 | gpl-3.0 | Finds viral moments, transcribes, reframes to 9:16 with captions | plan (highlights), transcribe (WhisperX), visual-check (face tracking) |
| haidrrrry/claude-remotion-skill | 299 | mit | Motion-graphics rules and render-inspect-fix loop for Remotion | edit (render, extract frames, inspect) |
| HeZhang1994/video-audio-tools | 232 | mit | FFmpeg wrapper for extract, merge, cut and convert (last push 2020) | inventory (audio extract), edit (cut and concat) |
| xuliang2024/cutcli-cookbook | 198 | mit | CLI to generate CapCut and Jianying drafts from agents | edit (template styling), approve-final (draft integrity) |
| KyaniteLabs/kinocut | 197 | apache-2.0 | Guardrailed FFmpeg MCP server with typed tools and quality gates | inventory (provenance, preflight), approve-final (render checks) |
| Visko-Platform/VEFX-Bench | 177 | apache-2.0 | VLM reward model scoring video edits on instruction, quality and exclusivity | visual-check (scoring), edit (exclusivity), approve-plan |
| znyupup/ai-video-editing-skill | 148 | mit | Raw travel footage to vlog with ffmpeg, Whisper and vision | transcribe (hallucination filter), edit (concat demuxer, BGM ducking) |
| GML-MMGroup/ClipTalk | 136 | other | NL instructions to automated cuts with a plan and refine loop | plan (shot boundaries), inventory (active speaker) |
| video-db/skills | 127 | mit | Server-side video API: ingest, OCR, speech, trim and merge | transcribe (visual context), edit (trim and merge) |
| notivn/AIEV | 126 | mit | Claude-orchestrated HyperFrames motion graphics and Remotion timeline | transcribe (word timestamps), approve-final (GPU to CPU fallback) |
| kurbaitaev/ghost-editor | 66 | mit | LLM cutting, captions and motion graphics for reels | transcribe (noise cleaning), visual-check (face-safe captions) |
| Noah-Grimaldi/auto-gaming-montage-maker | 62 | none listed | Highlight detection, silence removal and captions for game footage | edit (silence pass), transcribe |
| oktaydbk54/vibeclip | 59 | agpl-3.0 | Chat-refined long-form to 9:16 captioned shorts | edit (undo over a plan), transcribe (local Whisper) |
| mfahsold/montage-ai | 53 | other | Beat-synced rough cuts with scene analysis and LLM direction | plan (style templates), edit (dialogue ducking, quality profiles) |
| ap-atul/Torpido | 45 | unlicense | Ranks segments by motion, blur, audio energy and text | edit (drop idle footage), visual-check (on-screen text) |
| FRSname/CapForge | 44 | mit | Word-level transcription with diarization, caption styling, metadata | transcribe (WhisperX), approve-final (platform limits) |
| Anil-matcha/AI-Youtube-Shorts-Generator | 5281 | mit | Viral clip extraction with LLM scoring and Whisper | plan (multi-factor scoring, dedupe), transcribe (chunking, cache) |
| m1guelpf/auto-subtitle | 2290 | mit | Whisper subtitles overlaid with ffmpeg | transcribe, edit (overlay) |
| 0xsline/OpenChatCut | 2213 | agpl-3.0 | Local multi-track editor with transcript-driven cuts | transcribe and edit (word-level text cuts), visual-check (face-safe zones) |
| ThioJoe/Auto-Synced-Translated-Dubs | 1746 | agpl-3.0 | Translation and dubbing synced to SRT timing | edit (time-stretch, track merge), transcribe (pause preservation) |
| denizsafak/AutoSubSync | 1203 | gpl-3.0 | Subtitle sync to video with multiple engines | transcribe (align), visual-check (ms offsets) |
| jipraks/yt-short-clipper | 1028 | mit | Long YouTube video to short clips with highlight detection | edit (face-tracking 9:16), plan (time-range override) |
| ronak-create/FableCut | 706 | mit | Browser NLE whose whole project is one JSON document, MCP and REST | plan and edit (single JSON source of truth), edit (locked clips) |
| ncounterspecialist/twick | 537 | other | React video editor SDK with captioning and serverless render | edit (canvas overlays), visual-check (preview render) |
| RayFernando1337/MLX-Auto-Subtitled-Video-Generator | 464 | mit | Apple Silicon Whisper transcription to SRT and VTT | transcribe (model choice, VTT and SRT) |
| mushigaite/short-video-maker | 282 | mit | Long to short clips with virality scoring and classification | plan (scoring, dedupe), edit (hook insertion) |
| line/lighthouse | 271 | apache-2.0 | Moment retrieval and highlight detection from a text query | plan (saliency ranking), edit (segment isolation) |
| wjun0830/QD-DETR | 253 | other | Query-dependent moment and highlight detection model | plan (highlight), transcribe (ASR pre-training) |
| nganlinh4/oneclick-subtitles-generator | 242 | none listed | Transcription, translation and timeline editor with waveform | edit (waveform timing), transcribe (local fallback) |
| TencentARC/UMT | 238 | other | Joint moment retrieval and highlight detection | plan (filter off-beat footage), visual-check (check key moments kept) |
| HelpFreedom/kadr | 210 | gpl-3.0 | GPU video editor with Claude Code on the timeline | edit (beat sync, karaoke captions), transcribe (voice quality flag) |
| snailma0229/MS-DETR | 205 | none listed | Motion-semantic highlight detection | plan (engaging segments) |
| maxazure/video-editing-skill | 196 | none listed | Short-form pipeline: transcription, cutting, mixing, captions | edit (dead-air cut when audio and video both static), visual-check (glyph QA) |
| botbahlul/PyAutoSRT | 191 | mit | Google speech recognition subtitles with translation | transcribe (existing subtitle streams) |
| Aseiel/VideoHighlighter | 163 | agpl-3.0 | Scene, action and object detection for highlight reels | plan (multi-signal scoring), approve-plan (why report) |
| WeftCut/WeftCut | 159 | mit | NLE with the full editing toolset exposed over MCP | edit (dry run, history lock), edit (detect and remove pauses) |
| NaufalRizqullah/opensource-clipping | 155 | mit | Long-form to shorts with auto-framing, karaoke subtitles, ducking | edit (smart trim of silence and fillers), edit (MediaPipe framing) |
| Sirozha1337/faster-auto-subtitle | 73 | mit | faster-whisper subtitles, translation, burned or soft | transcribe (no_speech_threshold, beam size), edit (hard or soft subs) |
| DayadaUP/claude-code-auto-video-edit | 122 | mit | A-roll rough cut: keep the last good take, DaVinci timeline and SRT | plan (keep and drop cues, last take wins), edit (SRT aligned to cut) |
| OwlTing/AI_basketball_games_video_editor | 126 | apache-2.0 | YOLO detection of shots for highlight clips | plan (shot boundaries), edit (inference size) |
| kevinrss01/framedeck | 61 | none listed | NL to timeline edits with transcripts, in a multi-service stack | transcribe (asset status state machine), edit (isolated FFmpeg service) |

Dropped (43): krillinai/OpenCreator, makiisthenes/TiktokAutoUploader, artokun/comfyui-mcp, diego3g/video-to-reels, HA6Bots/Automatic-Youtube-Reddit-Text-To-Speech-Video-Generator-and-Uploader, VelornLabs/velorn, zackmawaldi/YouTube-shorts-generator, zszszszsz/.config, Sfedfcv/redesigned-pancake, ManojKumarPatnaik/Major-project-list, idwts/Crayotter, SaarD00/AI-Youtube-Shorts-Generator, GanerCodes/videoEditBot, Cassette-Editor/oh-my-cassette, HA6Bots/Twitch-Clips-Compilation-Generator-TCCG-, manpoai/AgentOfficeSuite, llambert721/AutoVideoCreator, 6v17/VideoSeek, gongnyang/reelforge, itsPremkumar/Automated-Video-Generator, aaqibmehrban/Automatic-Reddit-text-to-Video-Generator-and-youtube-uploader, salaheddinek/video-editing-py-script, BazzaCuda/MinimalistMediaPlayerX, nyaundid/EC2-AWS-AND-SHELL, thisismy-github/pyplayer, jsoncut/jsoncut-skill, pengchengneo/AgentCine, arashstar1/bot-lua, hypit-ai/hypit, Bomx/super-video-maker-skill, BatuhanYilmaz26/Auto-Subtitled-Video-Generator, itsjwill/vanta, tin2tin/Subtitle_Editor, EasonXiao-888/UVCOM, cfeng16/audio-visual-forensics, Crazyscholarr/AutoDubVN, feyzilim/clipfactory, zhuduowang/Change3D, ZhendongWang6/AltFreezing, ChrisAllenMing/Cross_Category_Video_Highlight, Serkali-sudo/auto-subtitle-generator, TheMattBerman/scrollclaw, botbahlul/autosrt

### Top ideas

1. **edit**: Cut dead air with a silence threshold and a margin before any creative edit, and only where audio and picture are both static. Source: WyattBlue/auto-editor (audio threshold, margin), maxazure/video-editing-skill (cut only when both are static), ap-atul/Torpido (motion and blur filter).
2. **edit**: Keep the last good take and drop the rest, using spoken cues such as "OK" or "pass". Source: DayadaUP/claude-code-auto-video-edit (keep and drop cues, last take wins).
3. **edit**: Cut at the transcript, not the timeline: word-level transcript edits and word-boundary cuts with a small pad. Source: 0xsline/OpenChatCut (transcript-driven cuts), WyattBlue/auto-editor (margin).
4. **plan**: Score candidate highlights on several factors, collapse overlaps, and show the reasons at approve-plan. Source: Anil-matcha/AI-Youtube-Shorts-Generator (multi-factor scoring, dedupe), Aseiel/VideoHighlighter (why report), line/lighthouse (saliency ranking).
5. **visual-check**: Score each render against the brief and check edit exclusivity, instead of a single pass or fail. Source: Visko-Platform/VEFX-Bench (instruction, quality and exclusivity scores), kinocut (render checks before the final gate).

### Hardening

1. **transcribe**: Whisper invents text over silence or background noise, so filler words and fake captions reach the plan. Filter quiet segments and set a no_speech threshold. Source: znyupup/ai-video-editing-skill (volume filter), Sirozha1337/faster-auto-subtitle (no_speech_threshold).
2. **edit**: A cut lands mid-word, or clips an onset, so the edit sounds broken. Cut on word boundaries with pads and short fades. Source: WyattBlue/auto-editor (margin), 0xsline/OpenChatCut (word-level cuts), the pipeline's own 30 ms fades.
3. **edit**: Joining clips drops frames or drifts audio against picture. Use the concat demuxer, and bake pre-lap and J-cut audio into the render. Source: znyupup/ai-video-editing-skill (concat versus filter), maxazure/video-editing-skill (render_final pre-laps and J-cuts), ThioJoe/Auto-Synced-Translated-Dubs (time-stretch).
4. **visual-check**: Captions cover the speaker's face or on-screen UI. Keep captions out of face-safe zones and check it on the frame. Source: kurbaitaev/ghost-editor (face-safe positioning), 0xsline/OpenChatCut (face-safe zones), RafaelGodoyEbert/ViralCutter (face tracking for 9:16).
5. **approve-final**: The export fails on GPU, or the file will not play on the target platform, and the run stops. Fall back to CPU and check the file after render. Source: notivn/AIEV (GPU draft, CPU final, fallback), KyaniteLabs/kinocut (faststart and metadata checks).

## clips-to-scheduled-posts

Relevant: 45 of 50 mined repos. Each row does a similar job to a step of this pipeline.

Dropped (off-topic or same job as another row): OPTIMUM-LINKUP/Latest-Optimum-School-System, Siphon880gh/n8n-automation-viewer, mhowerton91/history, ahmedoher/css3, pratikkuikel/distraction-free.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| Anil-matcha/AI-Youtube-Shorts-Generator | 5281 | mit | automated pipeline to identify, crop, and format viral-ready 9:16 short-form clips from long-form... | moments: virality score on hooks and peaks; transcribe: chunk long videos |
| brightbeanxyz/brightbean-studio | 2421 | agpl-3.0 | BrightBean Studio is an open-source social media management platform that handles content... | style: per-platform overrides; schedule: rate-limit tracking |
| trypostit/trypost | 685 | agpl-3.0 | TryPost is an open-source social media management platform that provides a unified calendar,... | copy: one composer for many platforms; ingest: media retention |
| faris-sait/openshorts | 126 | mit | OpenShorts is an open-source platform that automates the creation of viral short-form clips from... | cut: smart 9:16 framing with subject tracking |
| ShadowSlayer03/Post4U-Schedule-Social-Media-Posts | 124 | mit | A self-hosted dashboard and backend for scheduling and cross-posting content to multiple social... | copy: per-platform limits; schedule: back-off per API |
| ndesv21/socialclaw | 95 | mit | SocialClaw is a CLI and MCP-enabled tool that provides a unified API and agent-friendly interface... | check: validate schedule and media before apply; schedule: idempotency keys |
| zernio-dev/latewiz | 83 | mit | LateWiz is an open-source social media scheduling platform that allows users to manage and schedule... | schedule: multi-platform distribution; expired-token handling |
| profullstack/social-poster | 49 | none listed | A CLI tool that uses Puppeteer to automate social media posting across multiple platforms by... | schedule: session persistence where no API exists |
| ArmanShirzad/SocialMediaContentCreationAndPostingAutomationPlatform | 47 | apache-2.0 | automated content pipeline that scrapes news, translates/summarizes it using LLMs, generates videos... | schedule: queue with cooldown per platform |
| BlueBash/Autogen_Video_Refinement | 42 | none listed | Microsoft Autogen and Whisper to automatically transcribe long videos and extract key segments to... | transcribe: Whisper transcript; moments: extract key segments |
| SakethSripada/Flask-SocialMedia-Automation | 38 | mit | A Flask-based web application that automates social media posting on Instagram and Twitter using... | schedule: database-backed queue |
| harshmriduhash/Social-Media-AI-Agent | 30 | none listed | AI-powered automation framework for Instagram, utilizing Puppeteer for browser interaction and... | schedule: proxy support against account flagging |
| fajrisilmi12-cyber/hermes-socmed-function | 20 | mit | specialized tools for AI image generation, multi-platform social media posting, and automated... | copy and schedule: AI image and multi-platform post |
| kirat11X/video--clipper-vizard-AI-replica-automatic-short-form-clip-generator- | 19 | mit | local, multi-modal pipeline that converts long-form videos into short-form clips using audio,... | moments: local multimodal clip detection |
| postmill-ai/postmill-app | 18 | agpl-3.0 | Postmill is an AI-native social media management platform that provides tools for content creation,... | copy: multi-channel content creation |
| tang-vu/social-posting-skills | 12 | mit | framework for transforming a single content source into multi-platform social media campaigns using... | copy: one source to multi-platform campaign |
| solutionok/SocialCampainTool | 12 | none listed | PHP-based system for automating social media posts and managing marketing campaigns | schedule: campaign posting |
| cbsshekhawat18-lab/social-stats-social-media-manager | 11 | mit | An open-source, self-hostable social media management platform providing scheduling, analytics, and... | schedule: scheduling with AI assist |
| postbasehq/postbase | 11 | agpl-3.0 | Postbase is an MCP-native social media scheduler that allows AI agents to draft, schedule, and... | copy and schedule: MCP-native drafts and scheduling |
| lumizone/postsider | 11 | agpl-3.0 | PostSider is an open-source social media management platform that provides a multi-channel... | schedule: multi-channel scheduling |
| pendpost/pendpost | 11 | mit | pendpost is an agent-first social media platform that uses a human-in-the-loop approval gate to... | approve: human-in-the-loop approval gate |
| ankitsharma-tech/Flask-Social-Media-Automation | 10 | mit | Flask-based web application that automates social media posting on Instagram and Twitter using... | schedule: Instagram and X posting |
| VladPolus/ViriaRevive | 9 | mit | ViriaRevive is a desktop application that automates the transformation of long-form YouTube videos... | moments and cut: long YouTube to shorts |
| josephHelfenbein/RecapGrid | 9 | apache-2.0 | RecapGrid is an AI-powered video summarization tool that automatically detects key moments,... | moments: key moments with narration |
| MrsHorrid/openclaw-social-scheduler | 7 | none listed | CLI-based social media scheduler that automates posting to multiple platforms (Discord, Reddit,... | schedule: CLI multi-platform scheduler |
| kashyapprajapat/shortreelx_frontend | 7 | none listed | ShortReelX is an AI-powered platform that automates the transformation of long-form videos into... | cut: long video to short clips |
| GrepCut/OpenClipper | 7 | mit | Open Clipper is an open-source desktop application that automates the process of turning long-form... | cut: long video to clips |
| daksh01010/andy-bot | 7 | none listed | ANDY-Agent is an autonomous AI content creation system that automates the entire lifecycle of video... | ingest to schedule: full content lifecycle |
| maikroservice/threaduler | 6 | mit | Threaduler is an open-source social media scheduler that integrates with Notion to manage and... | schedule: Notion-backed content calendar |
| ghost1412/shorts-generator | 6 | mit | ShortsFlow AI Studio is an open-source tool that automates the creation of short-form videos from... | cut: shorts from long-form |
| SermonPress-AI/n8n-social-media-posting-automation | 6 | mit | n8n workflow to automate the transformation of sermon data from a website into formatted social... | copy: source to social post variants |
| mdanikhasan-me/Soctukit | 6 | other | SoctuKit is a Windows desktop application that unifies social media management, drafting, and... | schedule: unified publishing desktop |
| MeowAI-HK/meowus | 5 | mit | Meowus is an open-source agentic system that automates social media workflows including content... | copy: agentic content generation |
| backblaze-b2-samples/ai-shorts-generator | 5 | mit | An open-source AI shorts generator that automates the workflow of transcribing long-form video,... | transcribe and moments: find engaging segments |
| clawnify/OpenPost | 4 | mit | OpenPost is a multi-channel social media scheduling platform that manages content creation,... | schedule: multi-channel scheduling |
| RAZ-05/Tiktok-auto-2.0 | 4 | mit | Python-based tool to automatically split long videos into short clips and generate subtitles using... | cut: split long video into clips |
| lxgicstudios/lxgic-clipper | 4 | mit | An AI-powered automation pipeline that detects highlights in livestreams, formats them for social... | moments: highlight detection in livestreams |
| pdwarkanath/social-media-automation | 4 | none listed | automates the workflow of capturing social media content (tweets), processing images, and... | schedule: cross-posting |
| stukenov/postpilot | 3 | mit | PostPilot is a headless-browser-based social media automation tool that treats content as code by... | schedule: content as code |
| Abhishek-B-R/social0-oss | 3 | agpl-3.0 | A multi-platform social media scheduler that provides a unified API, CLI, and MCP server for... | schedule: unified API and MCP server for posting |
| syed-reza98/SMCM | 3 | mit | SMCM is a comprehensive social media management platform that automates multi-platform scheduling,... | schedule: multi-platform scheduling |
| DivyanshuRanjanDynamic/ClipGenius-AI | 3 | mit | enterprise-grade platform that uses AI (Gemini, WhisperX) and computer vision (LR-ASD) to... | moments: speaker-aware clip selection |
| hashimamjad-dev/ShortsForge | 3 | mit | ShortsForge is an automated pipeline that converts long-form videos into viral-ready vertical clips... | cut: long-form to vertical clips locally |
| nirvagold/stream-clipper | 3 | mit | A desktop application that uses audio analysis (RMS/VAD) and chat activity to automatically detect... | moments: audio energy and chat activity |
| preethamvishy/stacked | 3 | none listed | tool for scheduling social media content across various platforms | schedule: multi-platform scheduling |

### Top ideas

1. moments: score candidates on hook, emotional peak and opinion, not length. Source: Anil-matcha/AI-Youtube-Shorts-Generator.
2. transcribe: chunk videos over 30 minutes with overlap. Source: Anil-matcha/AI-Youtube-Shorts-Generator.
3. copy: one source, tailored per platform within its limits. Sources: trypostit/trypost, ShadowSlayer03/Post4U-Schedule-Social-Media-Posts.
4. approve: human approval gate before anything is scheduled. Source: pendpost/pendpost.
5. schedule: idempotency keys so a retry never double-posts. Source: ndesv21/socialclaw.

### Hardening

1. schedule: failure mode, a platform rate limit gets the account flagged. Handle with per-platform back-off. Sources: ShadowSlayer03/Post4U-Schedule-Social-Media-Posts, ArmanShirzad/SocialMediaContentCreationAndPostingAutomationPlatform.
2. schedule: failure mode, an expired token or disconnected account fails silently. Handle by stopping that job and naming the account. Source: zernio-dev/latewiz.
3. cut: failure mode, a 9:16 crop cuts out the speaker. Handle with subject-aware framing. Source: faris-sait/openshorts.
4. ingest: failure mode, raw video fills the disk. Handle with a retention and cleanup policy. Source: trypostit/trypost.
5. check: failure mode, a clip breaks a platform's media rules. Handle by validating media constraints before scheduling. Source: ndesv21/socialclaw.

## seo-audit-fix

Relevant: 42 of 50 mined repos. Each row does a similar job to a step of this pipeline.

Dropped (off-topic or same job as another row): bamlab/flashlight, cablate/mcp-google-map, cporter202/agentic-ai-starters, nicepkg/ai-workflow, MarcoNasi/TRAE-Agents, zubair-trabzada/ai-agency-claude, Bomx/qwoted-seo-backlinks-skill, growthack88/growth-marketing-os.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| coreyhaines31/marketingskills | 53829 | mit | A collection of markdown-based 'skills' that provide AI agents with specialized marketing... | audit: AI-search and schema checks |
| GoogleChrome/lighthouse | 30873 | apache-2.0 | Lighthouse is an open-source tool for making reports about the quality of web pages, specifically... | speed: Lighthouse runs; audit: SEO category only |
| AgriciDaniel/claude-seo | 18574 | mit | A comprehensive SEO analysis plugin for Claude Code that uses parallel specialized agents to audit... | audit: parallel specialist agents per area |
| zubair-trabzada/geo-seo-claude | 10974 | mit | comprehensive suite of tools and AI agents to optimize websites for AI-powered search engines (GEO)... | fix: llms.txt generation; audit: AI crawler rules |
| nowork-studio/notfair-plugin | 3912 | mit | structured library of specialized marketing and SEO workflows (skills) for AI agents to perform... | audit: live Search Console and GA4 data; prioritise: read-only |
| AgriciDaniel/claude-blog | 2347 | mit | A comprehensive Claude Code skill suite for automated blog creation, SEO optimization, and... | fix: content review gate with rubric |
| treosh/lighthouse-ci-action | 1291 | mit | GitHub Action to automate web performance auditing and budget testing using Lighthouse CI | speed: budgetPath budgets; speed: repeated runs |
| LeoYeAI/openclaw-marketing-skills | 1042 | other | A comprehensive library of 37 marketing skills and data connectors for AI agents to perform SEO,... | audit: search-console data |
| PhialsBasement/LibreCrawl | 1016 | mit | LibreCrawl is an open-source multi-tenant web crawler and SEO analysis tool that provides automated... | crawl: request settings and user-agent; audit: plugin modules |
| janreges/siteone-crawler | 938 | mit | SiteOne Crawler is a high-performance Rust-based tool for crawling, analyzing, and auditing... | audit: quality score per category; crawl: robots.txt compliance |
| StanGirard/seo-audits-toolkit | 815 | none listed | OSAT is an all-in-one SEO and security audit toolkit providing features like Lighthouse scoring,... | speed: Lighthouse score tracking; audit: security headers |
| StJudeWasHere/seonaut | 805 | mit | SEOnaut is an open-source tool that crawls websites to identify and categorize SEO issues like... | prioritise: severity scoring; crawl: redirect loops and chains |
| JeffLi1993/seo-audit-skill | 764 | mit | A two-layer (Script + LLM) SEO auditing tool that performs deterministic technical checks via... | audit: deterministic checks before LLM; crawl: SSRF controls |
| OpenClaudia/openclaudia-skills | 713 | mit | OpenClaudia is an open-source toolkit providing 78+ modular skills for AI coding agents to perform... | fix: pre-publish gates |
| Affitor/affiliate-skills | 700 | mit | A comprehensive framework of 50+ AI-powered skills for affiliate marketing, covering research,... | fix: research brief for content |
| unifapi-agent/agents | 589 | mit | suite of specialized marketing agents and MCP skills for performing live SEO audits, AI visibility... | audit: AI citation visibility check |
| iannuttall/seo | 566 | apache-2.0 | A CLI and MCP server that provides AI agents with structured SEO data, crawl results, and... | prioritise: rank by severity and visibility |
| foo-software/lighthouse-check-action | 512 | mit | GitHub Action to automate Lighthouse audits, including reporting, Slack notifications, and... | speed: minimum score threshold; audit: alerts |
| seo-skills/seo-audit-skill | 457 | mit | A comprehensive CLI and desktop tool that audits websites against 373 rules across categories like... | crawl: local SQLite store; crawl: timeouts and concurrency |
| lgraubner/sitemap-generator | 454 | mit | programmatic and CLI-based tool to crawl websites and automatically generate XML sitemaps while... | crawl: honour robots.txt and noindex |
| viasite/site-audit-seo | 304 | other | A comprehensive web service and CLI tool that crawls websites, performs Lighthouse audits, and... | audit: crawl, Lighthouse and meta extraction |
| saurabhsharma2u/search-console-mcp | 297 | mit | An MCP server that unifies Google Search Console, Bing Webmaster Tools, GA4, and AdSense data into... | audit: Search Console data |
| squirrelscan/squirrelscan | 272 | mit | Squirrelscan is a comprehensive website QA tool that audits SEO, performance, security, and 'Agent... | audit: SEO, performance and security QA |
| zrashwani/arachnid | 255 | mit | PHP-based web crawler that extracts SEO metadata (titles, H1s, meta descriptions) and supports... | crawl: SEO metadata extraction |
| gbessoni/seobuild-onpage | 254 | none listed | An AI agent system that generates high-ranking, LLM-friendly web pages by enforcing strict... | fix: on-page structure rules |
| janreges/siteone-crawler-gui | 253 | mit | SiteOne Crawler GUI is a cross-platform desktop application that provides a graphical interface for... | crawl: GUI for crawl results |
| vezaynk/Sitemap-Generator-Crawler | 245 | mit | A PHP-based crawler that recursively traverses websites to generate XML sitemaps with zero... | crawl: sitemap generation |
| yan-labs/yan-skills | 209 | mit | A comprehensive suite of AI agent skills for the entire lifecycle of independent website creation,... | fix: site creation skills |
| liangdabiao/GEO-Content-Optimizer-Skill | 205 | none listed | suite of tools (skills) for Generative Engine Optimization (GEO) to improve a brand's visibility... | fix: GEO content optimisation |
| Cesarjoquin/Marketing-Skills | 201 | mit | A production-ready TypeScript toolkit providing structured marketing workflows (skills) and a CLI... | audit: marketing workflows |
| Canonry/canonry | 171 | mit | Canonry is an agent-first AEO (Answer Engine Optimization) platform that provides tools for agents... | crawl: agent-first crawl and answer-engine checks |
| brightdata/geo-ai-agent | 170 | none listed | CrewAI to automate SEO content audits by crawling URLs, analyzing search results via SERP APIs, and... | audit: SERP-based content audit |
| mikestead/lighthouse-batch | 166 | mit | automates batch Lighthouse audits across multiple URLs, generating structured JSON/HTML reports and... | speed: batch Lighthouse over many URLs |
| aleksandr-alhoff/seo-landing | 165 | mit | specialized 'skill' for AI agents to transform standard landing pages into high-performance,... | fix: landing page SEO rewrite |
| yaojingang/GEOHub | 165 | agpl-3.0 | GEOHub is an evidence-bounded framework for AI agents to perform GEO (Generative Engine... | audit: evidence-bounded GEO checks |
| seranking/seo-skills | 160 | mit | suite of specialized AI agent skills for SEO tasks, transforming raw data from the SE Ranking MCP... | audit: SEO data to actions |
| kemalai/FreeCrawl-SEO-Tool | 139 | mit | A high-performance, local-first desktop crawler that performs 172 SEO checks, handles JS rendering,... | audit: 172 SEO checks with JS rendering |
| deepakness/google-ai-search-optimization | 137 | none listed | specialized skill for AI agents to audit, plan, and implement SEO optimizations based on official... | audit: AI search audit plan |
| Houseofmvps/ultraship | 123 | mit | A Claude Code plugin providing a suite of 40+ tools for production-ready audits including SEO,... | audit: SEO, security and accessibility audit |
| ModusCreateOrg/gimbal | 116 | mit | Gimbal is a web performance budgeting tool that automates audits for size, lighthouse scores, and... | speed: performance budgets |
| AKCodez/seo-god | 112 | mit | transforms Claude Code into an autonomous SEO operator that crawls, audits, measures, and... | audit and fix: autonomous SEO loop |
| AkashPriyadarshii/jev-seo | 97 | mit | jev-seo is a Rust-based CLI and MCP server that provides automated SEO/GEO audits, site crawling,... | crawl: Rust crawler and rank tracking |

### Top ideas

1. audit: deterministic checks first, LLM judgement only where needed. Source: JeffLi1993/seo-audit-skill.
2. audit and speed: Lighthouse with the SEO category plus performance. Source: GoogleChrome/lighthouse.
3. prioritise: rank by severity and search visibility, labelling partial data as heuristics. Sources: iannuttall/seo, StJudeWasHere/seonaut.
4. audit: ground findings in Search Console and GA4 data, not generic advice. Sources: nowork-studio/notfair-plugin, saurabhsharma2u/search-console-mcp.
5. speed: performance budgets enforced in CI. Sources: treosh/lighthouse-ci-action, ModusCreateOrg/gimbal.

### Hardening

1. crawl: failure mode, the crawler ignores robots.txt or noindex. Handle by honouring both. Sources: lgraubner/sitemap-generator, janreges/siteone-crawler.
2. crawl: failure mode, the agent is pointed at internal addresses. Handle with SSRF controls. Source: JeffLi1993/seo-audit-skill.
3. audit and prioritise: failure mode, an audit step writes to the site. Handle by keeping these steps read-only. Source: nowork-studio/notfair-plugin.
4. speed: failure mode, one noisy Lighthouse run triggers a false regression. Handle with several runs. Source: treosh/lighthouse-ci-action (numberOfRuns).
5. fix: failure mode, a fix is deployed without checks. Handle with pre-publish gates. Source: OpenClaudia/openclaudia-skills.

## deep-research-cited

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| assafelovic/gpt-researcher | 29,965 | apache-2.0 | sub-question decomposition, crawl, cited long-form report | decompose, draft |
| dzhng/deep-research | 19,771 | mit | iterative query generation and refinement loop with rate-limit handling | sweep, depth |
| nickscamara/open-deep-research | 6,294 | other | Firecrawl scraping plus reasoning model report | sweep, draft |
| firecrawl/firecrawl | 189,733 | agpl-3.0 | web to clean markdown or JSON for agents, search and crawl | sweep (page fetch) |
| unclecode/crawl4ai | 85,050 | apache-2.0 | LLM-friendly crawler returning clean markdown | sweep (page fetch) |
| 54yyyu/zotero-mcp | 5,290 | mit | search, read and cite papers in a Zotero library | sweep |
| openags/paper-search-mcp | 2,769 | mit | MCP and CLI to search and download papers from many academic sources | sweep (academic angle) |
| blazickjp/arxiv-mcp-server | 3,202 | apache-2.0 | arXiv metadata and LaTeX section reading over MCP | sweep, cite-check (BibTeX from records) |
| DeepXiv/deepxiv_sdk | 804 | mit | structured citations over academic papers | sweep |
| Leonxlnx/unlazy | 3,876 | mit | depth-tree method and evidence gates | approve-plan, critic |
| jordan-gibbs/hyperresearch | 3,809 | mit | adversarial audit, fact-check and source verification in Claude Code | critic, cite-check |
| Socialpranker/deepdive | 371 | mit | 12-phase research skill with a plan-review gate | decompose, approve-plan |
| Weizhena/Deep-Research-skills | 2,319 | mit | outline then investigation with human gates | approve-plan |
| mjasnikovs/pi-task | 142 | agpl-3.0 | fixed refine, research, grill, compose, critique stages | decompose, critics |
| guy-hartstein/company-research-agent | 2,296 | apache-2.0 | LangGraph multi-agent, source-backed structured reports | draft |
| AnotiaWang/deep-research-web-ui | 2,223 | none listed | verifies findings against source excerpts, cited report | cite-check |
| RUC-NLPIR/WebThinker | 1,470 | mit | searches, navigates pages and drafts inside reasoning | depth, draft |
| 917Dhj/DeepPaperNote | 1,164 | mit | extracts methods and evidence from one paper into notes | depth |
| NVIDIA-AI-Blueprints/deep-researcher-agent | 885 | apache-2.0 | citation-backed reporting backend | draft, cite-check |
| qx-labs/agents-deep-research | 794 | apache-2.0 | planner plus iterative gap-filling loops with caps | decompose, depth |
| firecrawl/open-researcher | 688 | none listed | split-view analysis with automatic citations | draft |
| damionrashford/RivalSearchMCP | 132 | mit | multi-source search with conflict detection | sweep, critic |
| h4444433333/net-deep-research | 123 | mit-0 | source reputation grading and structured evidence | sweep, cite-check |
| Aryan-Pardeshi/DeepResearch_AI | 94 | mit | evidence-grounded report with DOI resolution and approval gates | approve-plan, cite-check |
| extracurricular-ai/open-deep-research-with-web-ui | 73 | other | search fallbacks, parallel tasks, SQLite trace | sweep (provider fallback, resume) |
| zoharbabin/web-researcher-mcp | 65 | mit | web search, full-page reads, verified citations over MCP | sweep, cite-check |
| wheattoast11/openrouter-deep-research-mcp | 55 | mit | parallel research with consensus-backed synthesis | critics |
| LiXin97/agora-lab | 49 | apache-2.0 | adversarial meetings and paper-review gates | critics |
| wanshuiyin/Auto-claude-code-research-in-sleep | 17,163 | mit | cross-model review loops with automated verification | critics |
| SamurAIGPT/llm-wiki-agent | 3,612 | mit | contradiction detection across sources | critic |
| mshumer/OpenDeepResearcher | 2,791 | mit | loop decides when evidence is enough, drops duplicate URLs | depth, sweep |
| Ayanami0730/deep_research_bench | 838 | apache-2.0 | benchmark rubric for report quality | critics (rubric) |
| serenakeyitan/citation-check-skill | 251 | mit | lightweight citation validator skill | cite-check |
| Liyan06/MiniCheck | 228 | apache-2.0 | small model that checks a claim against a grounding document | cite-check (support test) |
| KRLabsOrg/verbatim-rag | 206 | mit | provenance-first RAG returning verbatim source spans | draft (quote spans), cite-check |
| superwesleyhys-ux/factcircuit | 574 | mit | auditable claim-and-evidence verification loop | critic, cite-check |
| BharathxD/ClaimeAI | 106 | mit | LangGraph fact-checker that splits text into verifiable claims | critics (claim split) |
| ghoulr/opencode-websearch-cited | 246 | apache-2.0 | plugin giving LLM web search with citations | sweep |
| Johell1NS/browser-search | 529 | mit | SearXNG search tiers for agent browsing | sweep (second provider) |
| InternLM/MindSearch | 6,938 | apache-2.0 | multi-agent web search and synthesis | sweep, depth |

Dropped notable (not relevant): khoj-ai/khoj, Alibaba-NLP/DeepResearch, MiroMindAI/MiroThinker, zilliztech/deep-searcher, SkyworkAI/DeepResearchAgent, bytedance/deer-flow, langchain-ai/langgraph, run-llama/llama_index, D4Vinci/Scrapling, apify/crawlee, virattt/dexter, arc53/DocsGPT, agentset-ai/agentset, 55 more general agent frameworks, RAG kits and unrelated deep-learning repos

### Top ideas

1. **draft**: Every claim carries a verbatim quote and a source id; uncited sentences are cut before cite-check. Source: AnotiaWang/deep-research-web-ui, KRLabsOrg/verbatim-rag, h4444433333/net-deep-research.
2. **critic**: List numbers and dates that disagree across sources as a conflict list, not a silent pick. Source: damionrashford/RivalSearchMCP, SamurAIGPT/llm-wiki-agent.
3. **sweep**: Grade each saved source and filter by domain tier before depth. Source: h4444433333/net-deep-research, zoharbabin/web-researcher-mcp.
4. **cite-check**: Resolve each citation against authoritative metadata (DOI, arXiv id) before the quote check, so a made-up key fails early; add an entailment test for "does the quote support the claim". Source: blazickjp/arxiv-mcp-server, Aryan-Pardeshi/DeepResearch_AI, Liyan06/MiniCheck, serenakeyitan/citation-check-skill.
5. **approve-plan**: Show the six plan items and depth, and do not search until approved. Source: Weizhena/Deep-Research-skills, Socialpranker/deepdive, mjasnikovs/pi-task.

### Hardening

1. **sweep**: Rate limits and dead providers stop the run. Fall back to a second provider. Source: dzhng/deep-research, extracurricular-ai/open-deep-research-with-web-ui, Johell1NS/browser-search.
2. **depth and patch**: The gap loop never ends on a hard query. Cap iterations and time, stop on a sufficiency check. Source: qx-labs/agents-deep-research, mshumer/OpenDeepResearcher, LiXin97/agora-lab.
3. **draft and cite-check**: A fabricated quote ships after the patch rounds run out. End the run with a visible failed-quote list, not a report. Source: jordan-gibbs/hyperresearch, superwesleyhys-ux/factcircuit.
4. **sweep and critic**: Syndicated copies of one article count as three sources. De-weight repeats and drop duplicate URLs. Source: jordan-gibbs/hyperresearch, mshumer/OpenDeepResearcher.
5. **sweep**: A crash or timeout loses the whole run. Persist state per step so resume starts at the failed step. Source: extracurricular-ai/open-deep-research-with-web-ui, mjasnikovs/pi-task, LiXin97/agora-lab.

## data-to-dashboard

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| Canner/WrenAI | 17,827 | other | governed text-to-SQL with an MDL semantic layer for agents | plan (KPI definitions), qa |
| dataease/SQLBot | 6,874 | other | chat-to-data analysis with RAG over table schema | plan, qa |
| metabase/metabase | 49,591 | other | open-source BI with questions, dashboards and embedding | build (dashboard layout reference) |
| recharts/recharts | 27,617 | mit | React chart library on D3 | build (chart parts) |
| plotly/plotly.js | 18,355 | mit | declarative JS charting with JSON chart specs | build (chart spec) |
| pyecharts/pyecharts | 15,774 | mit | Python builder for ECharts specs | build |
| Data-Centric-AI-Community/fg-data-profiling | 13,718 | mit | one-line data profiling report: types, missing values, outliers | load, qa |
| mholt/PapaParse | 13,585 | mit | robust CSV parser, handles quotes and bad rows | load (parse errors listed) |
| adaltas/node-csv | 4,281 | mit | streaming CSV parse and stringify for Node | load |
| BdR76/CSVLint | 250 | gpl-3.0 | CSV validation with schema and type checks | load (header and type check) |
| antvis/mcp-server-chart | 4,393 | mit | MCP server with 25+ chart types, checks data fit | build, readback (spec validation) |
| hustcc/mcp-echarts | 269 | mit | MCP server generating ECharts with validation | build, readback |
| observablehq/framework | 3,660 | isc | static site generator for data apps with precomputed snapshots | build (single static output) |
| StructuredLabs/preswald | 4,268 | apache-2.0 | packages Python data apps into one WASM bundle | build (single-file export) |
| nshiab/simple-data-analysis | 356 | mit | DuckDB-powered TypeScript steps for tabular data | clean (chainable steps) |
| dbt-labs/dbt-charts | 554 | apache-2.0 | declarative YAML over SQL for dashboards, easy for agents | plan, build (spec validation) |
| JetBrains/databao-agent | 157 | other | chat with your data through a semantic layer | plan |
| holoviz/lumen | 316 | bsd-3-clause | agent turning questions into SQL, charts and dashboards | plan, build |
| getnao/nao | 1,739 | other | analytics agent that builds context from a warehouse first | plan |
| mprove-io/mprove | 338 | apache-2.0 | agentic BI over a Malloy semantic layer | plan |
| datagallery-ai/dataagent | 785 | apache-2.0 | DataFoundry: AI workbench keeping the SQL trace, read-only access | qa (SQL trace), load |
| zhongyu09/openchatbi | 666 | mit | chat BI with row caps and SQL guard | qa, readback |
| togethercomputer/open-data-scientist | 190 | mit | data-science agent running code in Docker | build (sandbox) |
| HKUSTDial/DataMagic | 298 | mit | table to narrated animated video, maps values to labels and units | readback, narrate |
| VisActor/VMind | 470 | mit | intelligent chart generation, picks chart type from data | plan (chart choice) |
| RamiAwar/dataline | 1,596 | gpl-3.0 | chat with CSV and databases, charts from answers | plan, build |
| rhiever/datacleaner | 1,078 | mit | auto-clean tables: impute, encode, drop | clean (deterministic pass) |
| Wilson-ZheLin/Streamline-Analyst | 491 | mit | LLM agent running clean, prep and analysis end to end | clean, plan |
| Varn1t/EDAgent | 67 | none listed | multi-agent EDA with two-pass cleaning and top-correlation summaries | clean, plan |
| ellie886/Datalume | 135 | none listed | data-analysis agent limited to whitelisted analysis functions | build (function whitelist), qa |
| VincenzoManto/Datacmd | 107 | mit | raw data to terminal dashboards with header and type validation | load, build |
| posit-dev/pointblank | 494 | mit | data validation toolkit with threshold reports | qa (declared checks) |
| Quantco/dataframely | 619 | bsd-3-clause | declarative dataframe schema validation | load (schema drift) |
| canimus/cuallee | 250 | apache-2.0 | DataFrame-agnostic quality check library | qa |
| sqlpage/SQLPage | 2,574 | mit | SQL-only dashboards: a query becomes a page | build (alternative output) |
| liangdabiao/claude-data-analysis | 441 | none listed | Claude Code data-analysis agent over CSV | plan, build |
| melihbirim/csvql | 30 | mit | SQL over CSV files for agents | qa (recompute numbers) |
| vizzuhq/vizzu-lib | 2,039 | apache-2.0 | animated charts and data stories | narrate (story order) |
| JasonObeid/Chart2Text | 161 | none listed | generates plain-language explanations from charts | narrate |
| manzt/quak | 411 | mit | scalable data profiler and table viewer | qa (look at the table) |
| ubershmekel/gfilter | 9 | mit | cross-filter dashboard for any CSV | build (cross-filter idea) |

Dropped notable (not relevant): pingcap/tidb, apache/doris, databendlabs/databend, spiceai/spiceai (databases), frappe/insights, mariusandra/insights, widestage/widestage, jortilles/EDA (full BI servers), antgroup/Agentar-Scale-SQL, premAI-io/premsql, cfahlgren1/natural-sql (text-to-SQL models), LobsterAI, GeoAgent, AstraZeneca/cellatria, 40 CSV parsers in other languages and unrelated plotting libs

### Top ideas

1. **plan**: Define each KPI once (metric, filter, join) in a semantic layer; build reads only those definitions. Source: Canner/WrenAI, dbt-labs/dbt-charts, JetBrains/databao-agent, mprove-io/mprove.
2. **qa**: Recompute every headline number deterministically in SQL or pandas and compare with the table, not with the model's own sum. Source: ellie886/Datalume, datagallery-ai/dataagent, melihbirim/csvql.
3. **clean**: Deterministic pre-cleaner for types, dates, currency and blanks; the model sees only leftovers. Source: Varn1t/EDAgent, rhiever/datacleaner, nshiab/simple-data-analysis.
4. **load**: Profile the CSV first (types, missing values, bad rows) and write the profile for qa to read. Source: Data-Centric-AI-Community/fg-data-profiling, mholt/PapaParse, BdR76/CSVLint.
5. **readback**: Validate each chart spec and the chart type against the data before render. Source: hustcc/mcp-echarts, antvis/mcp-server-chart, dbt-labs/dbt-charts, VisActor/VMind.

### Hardening

1. **load and qa**: The agent writes a destructive query. Use read-only access and a SQL guard. Source: Canner/WrenAI, zhongyu09/openchatbi, datagallery-ai/dataagent.
2. **clean**: The table is too big for context and rows are lost. Pass summaries, not rows, and cap rows returned. Source: Varn1t/EDAgent, zhongyu09/openchatbi.
3. **build**: Model-written chart code runs on the host. Sandbox it or allow only whitelisted functions. Source: togethercomputer/open-data-scientist, ellie886/Datalume.
4. **load**: The CSV changes shape between runs. Validate headers and types against a declared schema before clean. Source: Quantco/dataframely, posit-dev/pointblank, VincenzoManto/Datacmd.
5. **readback**: A screenshot looks right while the printed number is wrong. Compare parsed page numbers with the table value and map values to labels and units. Source: HKUSTDial/DataMagic, canimus/cuallee.

## form-fill-batch

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| pywinauto/pywinauto | 6,204 | bsd-3-clause | Windows GUI automation in Python through the UIA tree | map, fill (set_focus, value set) |
| yinkaisheng/Python-UIAutomation-for-Windows | 3,585 | apache-2.0 | Python wrapper of Microsoft UI Automation with ValuePattern, capture | map, fill, shot |
| mediar-ai/terminator | 1,652 | mit | Playwright-style computer use for Windows with retries | fill (obscured-element retry) |
| lahfir/agent-desktop | 1,779 | apache-2.0 | desktop control for agents with stable element references | map, fill (@id refs) |
| sbroenne/mcp-windows | 108 | mit | MCP to control Windows apps by accessible element names | map, fill |
| shanselman/FlaUI-MCP | 103 | mit | MCP for Windows through FlaUI and UI Automation, 30 s timeout | map, fill, confirm (get_text) |
| remorses/usecomputer | 337 | mit | fast computer-automation CLI with window-scoped screenshots | shot |
| openai/openai-cua-sample-app | 1,889 | mit | computer-using-agent sample with replay JSON and stuck-key release | fill, approve (replay log) |
| AMAP-ML/LongHorizon-Harness | 1,704 | mit | long-horizon computer-use harness with verified-state checkpoints | approve (evidence), confirm |
| congchuanling-dot/Cohort | 199 | mit | local agent runtime with controlled tools and acceptance contracts | confirm (acceptance check) |
| AmrDab/clawdcursor | 403 | mit | compiles the screen into one UI map; kill switch, settle wait | map, fill (settle, stop switch) |
| mrpulor-gh/nuphus-mcp | 322 | mit | desktop automation MCP: screen, mouse, keyboard | fill, shot |
| OpenAdaptAI/OpenAdapt | 1,763 | mit | compiles a demonstrated GUI task into a program that reports VERIFIED only | map, confirm |
| microsoft/skill-recorder | 4,211 | mit | records an on-screen work session into a reusable skill | map (record a first fill) |
| beuaaa/pywinauto_recorder | 199 | mit | record and replay GUI actions through pywinauto | fill (replay) |
| trycua/cua | 29,107 | mit | computer-use drivers, sandboxes and benchmarks | fill (sandbox for dry runs) |
| Skyvern-AI/skyvern | 23,163 | agpl-3.0 | AI browser workflows including form fills | map, fill |
| simular-ai/Agent-S | 12,567 | apache-2.0 | agentic framework using computers like a human | fill |
| askui/python-sdk | 555 | mit | AI control of desktop and mobile UIs | fill |
| robocorp/rpaframework | 1,574 | apache-2.0 | RPA libraries: Excel, desktop, browser | map (read the sheet), fill |
| tebelorg/RPA-Python | 5,502 | apache-2.0 | Python RPA package with visual and DOM automation | fill |
| iflytek/astron-rpa | 5,258 | apache-2.0 | agent-ready RPA suite | fill |
| saucepleez/taskt | 1,369 | apache-2.0 | free RPA builder with Windows input actions | fill |
| open-rpa/openrpa | 3,087 | mpl-2.0 | open RPA with record and replay on Windows | fill |
| sandraschi/windows-computer-use-mcp | 41 | mit | 22 MCP tools for click and type on Windows | fill |
| ThePacielloGroup/aviewer | 164 | apache-2.0 | inspector for the Windows accessibility tree | map (see field names) |
| dm-vodopyanov/py_inspect | 27 | none listed | Inspect.exe analogue using pywinauto | map (see field names) |
| awlevin/typesafe-computer-use | 1,208 | mit | OCR the screen, classify, act at tiny cost per step | shot, confirm |
| a-real-ai/pywinassistant | 1,341 | mit | open-source Windows assistant driving apps through UIA | fill |
| amruthvvkp/flaui-uiautomation-wrapper | 18 | gpl-3.0 | full FlaUI API for Python | map, fill |
| botcity-dev/botcity-framework-core-python | 144 | apache-2.0 | BotCity Python RPA framework | fill |
| clicknium/clicknium-docs | 161 | apache-2.0 | GUI automation for web and desktop apps | fill |
| AhmadHassan-BTed/FormFilla | 249 | other | local-first extension filling forms from a stored profile | map (profile to field) |
| Br1an67/OpenJobAutofill | 105 | mit | privacy-first AI form autofill extension | map |
| FlaUI/FlaUI | 3,167 | mit | .NET UI Automation library, the base most Windows drivers wrap | map, fill (reference for UIA3 patterns) |
| microsoft/WinAppDriver | 4,052 | mit | WebDriver server that drives Windows apps by accessibility id | fill (stable locators by AutomationId) |
| FlaUI/FlaUInspect | 639 | mit | inspector showing a window's UIA tree and patterns | map (check which fields expose a value pattern) |
| mapbox/pixelmatch | 6,987 | isc | tiny pixel-level image diff with a diff image output | confirm (diff filled form against the approved shot) |
| microsoft/playwright-mcp | 37,957 | apache-2.0 | browser control through accessibility snapshots, no pixels | map, fill (web forms by role and label) |
| AutoHotkey/AutoHotkey | 13,258 | gpl-2.0 | Windows macro and control scripting; ControlSetText sets a field without typing | fill (fallback for apps with no value pattern; call it, do not copy) |
| Fedetrain/autofiller-universal | 0 | mit | batch web-form filler with self-healing selectors, offline rehearsal, data pre-flight | map (pre-flight rows), fill (dry run) |

Dropped notable (not relevant): robotframework-flaui, FlaUIRecorder and Pulover's Macro Creator (duplicate wrappers or recorders of kept repos), mcp-playwright (same job as playwright-mcp), single-script CSV form fillers with 0 to 17 stars (copy one idea each at most), pdf form fillers and visual-regression CI tools (wrong job), SeleniumHQ/selenium, chromedp/chromedp, webdriverio, Skyvern peers (nanobrowser, HyperAgent, agentql: browser only), captcha tools (techinz/playwright-captcha, noCaptchaAi, EzSolver, Botright: not to be copied), stealth browsers (camofox, invisible_playwright), 60 desktop-agent shells and Windows tweak scripts

### Top ideas

1. **map**: Read the window's UI Automation tree and match each sheet column to a field by accessible name, not screen position. Source: sbroenne/mcp-windows, shanselman/FlaUI-MCP, pywinauto/pywinauto, ThePacielloGroup/aviewer.
2. **fill**: Set values through the element's value pattern or a stable reference; type only as a fallback (AutoHotkey ControlSetText for apps with no pattern). Source: microsoft/WinAppDriver, FlaUI/FlaUI, yinkaisheng/Python-UIAutomation-for-Windows, lahfir/agent-desktop.
3. **shot**: Capture the form window alone per row so the approve gate sees what submit will send. Source: remorses/usecomputer, yinkaisheng/Python-UIAutomation-for-Windows.
   **pre-flight** (new): check every row against the form's required fields before the first fill, and run one dry rehearsal row. Source: Fedetrain/autofiller-universal.
4. **confirm**: Read each field back from the UI tree after fill and diff against rows.json before the batch gate; pixel-diff the filled shot against the approved one just before submit. Source: mapbox/pixelmatch, shanselman/FlaUI-MCP, congchuanling-dot/Cohort, OpenAdaptAI/OpenAdapt.
5. **fill and approve**: Write a replay log of every action and screenshot per row as batch evidence; offer a recorded first fill as a template. Source: openai/openai-cua-sample-app, AMAP-ML/LongHorizon-Harness, microsoft/skill-recorder.

### Hardening

1. **captcha**: The agent tries to get past a captcha. Keep the hand-off to you; use detection only, never solver tools. Source: nuphus-mcp and mcp-windows detection aids (do not copy techinz/playwright-captcha).
2. **fill**: A modal dialog hangs the call. Use call timeouts and wait-for-element. Source: shanselman/FlaUI-MCP, yinkaisheng/Python-UIAutomation-for-Windows.
3. **fill**: Keystrokes land in the wrong window after focus moves. Set focus and record the window handle per row. Source: pywinauto/pywinauto, yinkaisheng/Python-UIAutomation-for-Windows.
4. **fill**: A stuck key or crashed loop leaves input held down. Release keys on crash and keep a kill switch. Source: openai/openai-cua-sample-app, AmrDab/clawdcursor.
5. **shot and fill**: The UI is still settling when the check runs. Wait a settle window and retry obscured elements. Source: AmrDab/clawdcursor, mediar-ai/terminator.

## prospect-list-to-drafts

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| ethanplusai/harvey | 103 | mit | autonomous sales agent on Claude CLI: prospects, cold emails, costed research | hook, write, approve-spend |
| Cold-IQ/ColdIQ-s-GTM-Skills | 296 | none listed | Claude Code GTM skills: sales triggers and email templates | hook, write |
| getcargohq/cargo-skills | 19 | mit | GTM skills for agents: build lead lists, find and verify emails | load, check |
| emelia-io/claude-outreach | 17 | mit | B2B outreach skill with sub-skills and sub-agents | write, check |
| getaero-io/gtm-eng-skills | 65 | mit | skills for waterfall email enrichment and identity validation | sources, hook, check |
| Othmane-Khadri/gtm-engineer-playbook | 58 | mit | 10 Claude Code skills for GTM work | hook, write |
| outreachmagic/outreachmagic | 11 | mit | unified data layer for agents: research leads, verify emails | sources, check |
| hunter-io/claude-plugin | 8 | mit | Hunter plugin: find and verify professional emails | check (verify) |
| hitb1099/outreach-os | 12 | mit | AI outreach with lead scoring, status states, personalised email | load, drafts (state per row) |
| austinchennn/cold-email | 13 | other | multi-agent cold-email pipeline with SQLite sent tracking, backoff | sources, drafts (dedupe) |
| PaulleDemon/Email-automation | 180 | other | open-source cold outreach tool with Jinja2 rendering | write, check (undefined vars) |
| dancolta/trustpilot-outreach-automation | 12 | none listed | signal-based outbound from low reviews, staggered requests | hook (public signal), sources |
| 434media/bizdev-agent | 9 | none listed | prospect research to sales email, timeouts and UA rotation | sources, hook |
| alexandertiopan1212/AI_Email_Crafter | 6 | none listed | personalised email drafts saved as drafts, never sent | write, drafts |
| alphaparkinc/genpark-cold-outreach-deliverability-spam-sanitizer-skill | 8 | none listed | sanitises cold copy for spam triggers and length | check (lint) |
| alphaparkinc/genpark-waterfall-enrichment-orchestrator-skill | 8 | none listed | multi-provider enrichment waterfall skill | sources |
| alphaparkinc/genpark-sales-email-personalization-engine-skill | 9 | none listed | flags hallucinated personalisation in sales email | check |
| AfterShip/email-verifier | 1,636 | mit | email verification without sending: syntax, MX, disposable, role | load, check |
| truemail-rb/truemail | 1,284 | mit | configurable email validator with MX and SMTP levels | load, check |
| umuterturk/email-verifier | 609 | mit | privacy-first email verifier | check |
| buyukakyuz/email-sleuth | 426 | mit | finds and verifies professional emails from names and domains | sources, check |
| Atum246/keelead | 37 | mit | lead engine over 62 sources with multi-layer email verification | sources, check |
| debpalash/OpenGTM | 42 | other | self-hosted Clay alternative: sourcing and enrichment waterfalls | sources |
| masteranime/enrichment-kit | 40 | mit | multi-vendor enrichment waterfall, bring your own keys | sources |
| firecrawl/fire-enrich | 1,276 | mit | AI enrichment turning emails into rich company data | sources, hook |
| kaymen99/sales-outreach-automation-langgraph | 399 | none listed | LangGraph lead research, qualification and outreach | hook, write |
| adityajha2005/yc-outreach | 162 | mit | pick a batch, get founders, write personalised cold emails | hook, write |
| LeadGrowGTM/poke-the-bear-skill | 4 | other | cold email method (Poke the Bear) as a Claude Code skill | write (style rules) |
| BayramAnnakov/lead-qualification-plugin | 22 | none listed | Claude Code plugin scoring lead fit | load (skip poor fits) |
| NightTrek/mistral-backlinker | 21 | none listed | AI agents research a company then write a personalised email | hook, write |
| iPythoning/b2b-sdr-agent-template | 190 | mit | AI SDR template with a staged sales pipeline | write, check |
| rqcai200/lead-enrichment-scoring | 24 | mit | cheap lead enrichment and scoring | load |
| jannismoore/lead-finder | 19 | mit | find and enrich leads with AI | sources |
| clawnify/OpenProspector | 12 | mit | open Clay alternative to find and enrich B2B leads | sources |
| LeadMagic/leadmagic-n8n | 11 | mit | n8n node for email finding, validation and company data | check |
| apifyforge/waterfall-contact-enrichment | 4 | mit | waterfall contact finder that stops at first hit | sources (cost) |
| D4Vinci/Scrapling | 86,442 | bsd-3-clause | adaptive scraping framework, survives page changes | sources (site fetch) |
| gosom/google-maps-scraper | 6,338 | mit | extracts business name, address, site from Google Maps | load (list source) |
| dmitriiweb/extract-emails | 111 | mit | extract emails and social links from URLs | sources |
| attentiontech/gtm-superintelligence | 93 | apache-2.0 | open GTM intelligence and automation | hook |

Dropped notable (not relevant): eracle/OpenOutreach (LinkedIn bot), kiryano/Scout, speedyapply/JobSpy, LinkedIn scrapers (joeyism/linkedin_scraper, linvo-io/linvo-scraper: terms risk), twentyhq/twenty and 15 CRMs (frappe/crm, SuiteCRM, espocrm), omkarcloud/google-maps-scraper and 9 Maps scraper clones, SES and Laravel sender platforms

### Top ideas

1. **hook**: Pick prospects whose own page shows a checkable gap (missing schema, stale blog, empty team page) so the one fact is real. Source: ethanplusai/harvey, getaero-io/gtm-eng-skills, dancolta/trustpilot-outreach-automation.
2. **sources**: Provider waterfall with dedupe, stopping at the first hit to save cost. Source: getaero-io/gtm-eng-skills, apifyforge/waterfall-contact-enrichment, debpalash/OpenGTM.
3. **check**: Verify each contact's domain (MX, disposable, role address) before any draft is written. Source: AfterShip/email-verifier, truemail-rb/truemail, Atum246/keelead.
4. **check**: Deterministic lint on every email before the model check: under 100 words, no unfilled braces, no spam triggers. Source: alphaparkinc genpark deliverability sanitizer, PaulleDemon/Email-automation.
5. **drafts**: Give each prospect a state (Pending, Drafted, Saved) so a re-run skips finished rows. Source: hitb1099/outreach-os, austinchennn/cold-email, alexandertiopan1212/AI_Email_Crafter.

### Hardening

1. **sources**: Sites rate-limit or block the fetch. Stagger requests and back off. Source: dancolta/trustpilot-outreach-automation, austinchennn/cold-email, 434media/bizdev-agent.
2. **write**: The email invents a detail about the prospect. Flag any claim not in the fetched page. Source: alphaparkinc genpark personalisation engine, getaero-io/gtm-eng-skills.
3. **hook**: The wrong person or company gets the email. Validate persona, title and domain match. Source: getaero-io/gtm-eng-skills, Cold-IQ/ColdIQ-s-GTM-Skills.
4. **drafts**: A second run duplicates Gmail drafts. Record state per row and check for an existing draft by recipient. Source: hitb1099/outreach-os, austinchennn/cold-email.
5. **load and approve-spend**: A huge list burns the lookup budget. Show a costed estimate and cap pages per site at the gate. Source: ethanplusai/harvey, apifyforge/waterfall-contact-enrichment.

## inbox-triage-drafts

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| elie222/inbox-zero | 12,435 | other | AI email assistant: rules, replies in your tone, cleanup | classify, draft (style from past sent mail) |
| cloudflare/agentic-inbox | 8,231 | apache-2.0 | self-hosted mail client with an AI agent and human confirmation | draft, approve (confirm before send) |
| langchain-ai/agents-from-scratch | 2,375 | mit | email assistant with human-in-the-loop and memory | classify, check |
| kaymen99/langgraph-email-automation | 278 | none listed | multi-agent customer email replies with relevance check | draft, check |
| stonefullstm/ai-email-triage | 13 | mit | cascade of heuristics, then embeddings, then LLM, with hash cache | classify, fetch (skip seen) |
| fazlerocks/jevmail | 93 | mit | Gmail triage into Needs reply, Updates, etc. with top-two probabilities | classify (confidence) |
| aziruhq/aziru | 9 | agpl-3.0 | self-hosted Gmail triage with read-only scopes, draft-only | fetch, draft |
| Ha22yX/auto-email-system | 51 | mit | triage and route mail to queues, untrusted HTML in sandboxed iframe | classify, fetch (HTML safe) |
| paabloLC/gmail-ai-draft | 6 | mit | Gmail watch via webhooks, GPT drafts, processed state | fetch, draft (once per thread) |
| sryo/GmailTidy | 6 | gpl-3.0 | Apps Script inbox zero with labels and follow-up reminders | classify, draft (ping once per thread) |
| astetic-dev/porter-intake-operator | 7 | mit | folder-based operator triaging an inbox with stop conditions, no-guess | classify (low confidence stop) |
| ZackAkil/AI-got-this-gmail-delegator | 23 | none listed | Gmail assistant that analyses mail and drafts replies | classify, draft |
| Ishabdullah/Aigentik-CLI | 14 | mit | watches Gmail over IMAP, rule pre-processing, drafts | classify (rules first) |
| AgriciDaniel/claude-email | 130 | mit | Claude Code skill for inbox triage and marketing mail | classify, draft |
| kl3inIT/zero-mail | 5 | mit | Gmail assistant: auto-triage, natural-language rules, reply drafts | rules, classify |
| maillifier/maillifier | 6 | mit | drafts replies to forwarded mail using Gemini | draft |
| mohsinsheikhani/property-maintenance-agent | 5 | none listed | eval-first triage agent for maintenance email | classify (test set) |
| AleBrito124356/inbox-agent | 2 | mit | IMAP fetch, classification, action items | fetch, classify |
| dgr8akki/inbox-clerk | 0 | mit | LLM classifies unread mail, labels, archives | classify |
| Vetri1706/openenv-email-triage-benchmark | 3 | none listed | triage environment with tasks and graders | check (benchmark) |
| AGENTVAULT-API/inbox-triage | 0 | mit | deterministic triage for shared inboxes, fails closed on legal mail | classify (fail closed) |
| madebydia/gmail-no-send | 2 | mit | drafts-only Gmail client for agent safety | drafts (no send path) |
| jeremyephron/simplegmail | 411 | mit | simple Gmail API client with thread-aware replies | fetch, draft (thread headers) |
| asweigart/ezgmail | 273 | gpl-3.0 | Pythonic Gmail API interface | fetch, drafts |
| leeguooooo/mail-use | 43 | mit | CLI and MCP with strict JSON errors, empty versus failed | fetch (error contract) |
| henry200803/mailbridge | 9 | mit | email MCP: search, read, draft, send with confirm flag | fetch, draft (confirm=true) |
| navbuildz/gmail-mcp-server | 15 | mit | Gmail MCP with multi-account, labels, archive | fetch, drafts |
| codefuturist/email-mcp | 125 | lgpl-3.0 | IMAP and SMTP MCP server: read, search, manage | fetch |
| nikolausm/imap-mcp-server | 103 | mit | IMAP and SMTP for AI assistants | fetch |
| pimalaya/himalaya | 7,413 | apache-2.0 | CLI to manage email over IMAP and SMTP | fetch |
| ikvk/imap_tools | 848 | apache-2.0 | IMAP library with search and flags | fetch |
| github/email_reply_parser | 710 | mit | splits the new reply from quoted history | classify, check (reply text only) |
| zapier/email-reply-parser | 528 | mit | Python parser stripping quoted text and signatures | classify, check |
| rspamd/rspamd | 2,545 | other | spam scoring with rules and fuzzy hashes | classify (rule score) |
| ascarola/verdictmail | 6 | mit | IMAP IDLE daemon with SPF, DKIM, DMARC and URL checks | classify (phishing flag) |
| alfaggodoy/phishing-eml-analyzer | 4 | none listed | 7-phase phishing analysis of .eml files | classify (suspect mail) |
| remorses/zele | 299 | none listed | Gmail, Outlook, IMAP CLI for terminal use | fetch |
| herald-email/herald-mail-app | 144 | other | terminal mail client with AI-assisted cleanup | classify |
| Kyubyong/msg_reply | 78 | apache-2.0 | message reply suggestion system | draft |
| nonozone/MailCli | 3 | apache-2.0 | local-first email interface for agents: structured inbox, search, triage | fetch |

Dropped notable (not relevant): novuhq/novu, Mailspring, BillionMail, mox, iRedMail (mail clients and servers), 20 HTML email template kits (mailchimp, mailgun, sendgrid), 25 text-classification model repos, eracle/OpenOutreach, ghostwright/phantom, KeyID-AI SDKs, agenticmail/agenticmail, inboundemail/inbound (agent mailboxes)

### Top ideas

1. **classify**: Run deterministic rules first (sender, unsubscribe, noreply, list headers, spam score) and call the model only for the rest. Source: stonefullstm/ai-email-triage, Ishabdullah/Aigentik-CLI, rspamd/rspamd.
2. **classify**: Store confidence and top two labels per message; send low confidence to the check gate, and fail closed on legal or complaint mail. Source: fazlerocks/jevmail, astetic-dev/porter-intake-operator, AGENTVAULT-API/inbox-triage.
3. **fetch**: Read-only scopes, fetch since last run, hash to skip seen mail, strip quoted history before classify. Source: aziruhq/aziru, stonefullstm/ai-email-triage, github/email_reply_parser.
4. **draft**: Drafts only, with a confirm flag on any send or delete path. Source: cloudflare/agentic-inbox, henry200803/mailbridge, madebydia/gmail-no-send.
5. **check**: Verify each reply against its own thread: same thread id, answers the open ask, promises nothing new. Source: kaymen99/langgraph-email-automation, jeremyephron/simplegmail, langchain-ai/agents-from-scratch.

### Hardening

1. **classify**: An email body tells the agent to act (prompt injection). Treat mail text as data and render HTML in a sandbox. Source: Ha22yX/auto-email-system, ascarola/verdictmail.
2. **fetch**: An empty result is read as no mail when the fetch failed. Return empty and failed as separate codes. Source: leeguooooo/mail-use.
3. **draft**: Two runs answer the same thread twice. Keep processed state per thread. Source: paabloLC/gmail-ai-draft, sryo/GmailTidy.
4. **fetch**: The push watch expires and mail is missed. Renew the watch and fall back to polling. Source: paabloLC/gmail-ai-draft, aziruhq/aziru.
5. **draft**: The reply ignores earlier messages or uses the wrong tone. Pull the full thread and match tone to past sent mail. Source: elie222/inbox-zero, henry200803/mailbridge.

## study-notes-to-pdf

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| microsoft/markitdown | 189,128 | mit | converts PDF, PPTX, DOCX and more to Markdown | ingest |
| PaddlePaddle/PaddleOCR | 90,835 | apache-2.0 | OCR and document parsing to structured data | ingest (scanned pages) |
| opendatalab/MinerU | 81,326 | other | PDF and Office docs to LLM-ready Markdown or JSON | ingest |
| datalab-to/marker | 40,308 | apache-2.0 | PDF to Markdown and JSON, re-processes low-confidence blocks | ingest (tables, maths) |
| ocrmypdf/OCRmyPDF | 34,968 | mpl-2.0 | adds a text layer to scanned PDFs | ingest (OCR pass) |
| opendataloader-project/opendataloader-pdf | 29,508 | apache-2.0 | PDF parser for AI-ready data | ingest |
| firecrawl/anydoc | 22,642 | mit | Word, PowerPoint, Excel, EPUB, PDF to clean Markdown | ingest (pptx slides) |
| firecrawl/pdf-inspector | 19,554 | mit | inspects a PDF and classifies text versus scanned, selective OCR | ingest (route per page) |
| Unstructured-IO/unstructured | 15,552 | apache-2.0 | document to structured elements | ingest |
| run-llama/liteparse | 12,813 | apache-2.0 | fast open-source document parser | ingest |
| The-Vibe-Company/megaparse | 7,413 | apache-2.0 | parser for PDFs and Office files tuned for LLM input | ingest |
| getomni-ai/zerox | 12,256 | mit | OCR and extraction with vision models | ingest (hard pages) |
| chatdoc-com/OCRFlux | 2,533 | apache-2.0 | merges cross-page tables, removes repeated headers | ingest (tables) |
| MarkPDFdown/markpdfdown | 2,295 | apache-2.0 | PDF to Markdown with vision LLM | ingest |
| landing-ai/ade-cli | 2,421 | apache-2.0 | agentic document extraction CLI | ingest |
| Dicklesworthstone/llm_aided_ocr | 3,002 | other | corrects Tesseract OCR errors with an LLM | ingest (OCR fix) |
| SakuraMathcraft/LaTeXSnipper | 1,018 | gpl-3.0 | formula recognition to LaTeX or Markdown | ingest (maths) |
| pymupdf/PyMuPDF | 10,865 | agpl-3.0 | PDF text, page images and layout in Python | ingest (slide text for check), proof (page render) |
| allenai/science-parse | 706 | apache-2.0 | parses PDFs into structured sections | outline |
| iamgio/quarkdown | 16,303 | gpl-3.0 | Markdown with superpowers for papers and slides | export |
| Wandmalfarbe/pandoc-latex-template | 7,273 | bsd-3-clause | Eisvogel: pandoc LaTeX template for Markdown to PDF | export (headers, footers) |
| simonhaenisch/md-to-pdf | 1,966 | mit | Markdown to PDF through headless Chrome with CSS | export |
| fnando/kitabu | 687 | mit | Markdown to paged PDF via Prince, with dependency checks | export |
| elipapa/markdown-cv | 1,499 | mit | Markdown plus CSS print rules for a clean PDF | export (print CSS) |
| asanzdiego/markdownslides | 142 | gpl-3.0 | Reveal.js and PDF slides from Markdown | export (slide-order layout) |
| AgriciDaniel/claude-obsidian | 15,420 | mit | provenance-aware knowledge base with claim ledger, lint, rollback | notes, check |
| yukunou703/studyproof | 20 | mit | local evidence workbench auditing AI text against source quotes | check (unverified status) |
| ZelinZhou-THU/lecture-notes-creator | 7 | apache-2.0 | course PDF to self-study notes, page-driven structure | outline, notes |
| Evan715823/cheatsheet-generator-skill | 201 | mit | slides and PDFs to dense LaTeX cheatsheets | notes, export |
| Manumarzo/AudioTTo | 19 | mit | audio and PDF slides to structured LaTeX study notes | notes, export |
| drpwchen/lecture-to-notes | 108 | mit | lecture recordings to grounded notes with a synced viewer | notes, check |
| rvmarreddy/lecture-summariser | 0 | none listed | local offline slide PDF to styled LaTeX/PDF notes | notes, export |
| flodlol/PDF-Slides-to-Handouts-Converter | 87 | mit | privacy-first slide to handout PDF | export (layout) |
| Blueturboguy07/NitroAI | 133 | agpl-3.0 | local-first study notes from PDFs, video, audio | notes |
| EricKart/AI901-Study-Kit | 12 | none listed | slide deck to notes with curriculum mapping | outline (module to slide map) |
| nasqret/live-workshop-skill | 25 | none listed | lecture to structured searchable knowledge base skill | outline |
| 2362094903-ops/study-assistant-skills | 24 | mit | Claude Code skills turning course material into study help | notes |
| ArthurYangX/nano-NotebookLM | 18 | apache-2.0 | turns course materials into notes and knowledge | notes |
| yigitkonur/api-llm-ocr | 902 | other | PDF to Markdown with vision LLMs preserving tables | ingest |

Dropped notable (not relevant): danburzo/percollate, alanshaw/markdown-pdf, jzillmann/pdf-to-markdown, adithya-s-k/marker-api, Graphify-Labs/graphify (code graph), 12 Markdown editors (marktext, Milkdown, vditor), 60 Anki and flashcard generators (ankitects/anki, 2anki, anki-llm), Obsidian plugins, note-taking apps, lecture-transcription apps (audio is out of scope)

### Top ideas

1. **ingest**: Classify each PDF page as text or scanned and OCR only scanned pages; keep slide text for the check step. Source: firecrawl/pdf-inspector, datalab-to/marker, ocrmypdf/OCRmyPDF, pymupdf/PyMuPDF.
2. **notes**: Every line carries a slide cite, and check fails any slide no line cites. Source: yukunou703/studyproof, ZelinZhou-THU/lecture-notes-creator, drpwchen/lecture-to-notes.
3. **check**: Audit each quote against slide text and mark unverifiable lines instead of keeping them; keep a claim ledger. Source: yukunou703/studyproof, AgriciDaniel/claude-obsidian.
4. **export**: Drive the PDF from one Markdown file with paged print CSS and a fixed template. Source: fnando/kitabu, elipapa/markdown-cv, Wandmalfarbe/pandoc-latex-template, simonhaenisch/md-to-pdf.
5. **outline**: Map modules to slide ranges first so a missing topic shows before notes are written. Source: EricKart/AI901-Study-Kit, ZelinZhou-THU/lecture-notes-creator.

### Hardening

1. **export**: A table or worked example splits across a page break. Add page-break rules and check layout before export. Source: simonhaenisch/md-to-pdf, fnando/kitabu.
2. **ingest**: OCR garbles tables and maths or repeats headers. Re-process low-confidence blocks and merge cross-page tables. Source: datalab-to/marker, chatdoc-com/OCRFlux, SakuraMathcraft/LaTeXSnipper.
3. **export**: The PDF step fails with no LaTeX or Chrome installed. Run a dependency check first. Source: fnando/kitabu, Wandmalfarbe/pandoc-latex-template, simonhaenisch/md-to-pdf.
4. **check**: An unsourced line survives the rewrite-once rule. Mark it unverified and lint for orphans. Source: yukunou703/studyproof, AgriciDaniel/claude-obsidian.
5. **notes and proof**: A failed proof pass leaves print.css half-edited and the PDF overwritten. Restore the last known-good file and apply changes as one bundle. Source: AgriciDaniel/claude-obsidian.
