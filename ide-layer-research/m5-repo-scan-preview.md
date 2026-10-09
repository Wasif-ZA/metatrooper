# M5 repo scan: preview and unshipped pipelines

Written 2026-10-09. Each pipeline got four to twenty GitHub searches (`gh search repos --sort stars`); the
most starred candidates had their README read by the local model (gemma4:12b, no cloud tokens), then a Haiku
pass kept only the repos that do the pipeline's job or one of its steps' jobs, including tools a step could
call or copy. Nothing here is built before launch (M5-D11); it is the idea bank for each lane when it leaves
preview. The coding built-ins have their own scan in `m5-hardening-coding.md`.

Where a lane has fewer than 40 relevant repos, the close-match space on GitHub ran out: the count is what
survived the relevance check, never padded.

| Pipeline | READMEs read | Relevant repos |
|---|---|---|
| website-build | 50 | 44 |
| design-variants | 145 | 29 |
| docs-and-release-notes | 50 | 42 |
| security-review-and-upgrade | 90 | 43 |
| footage-to-edit | 90 | 47 |
| clips-to-scheduled-posts | 50 | 45 |
| seo-audit-fix | 50 | 42 |
| deep-research-cited | 90 | 36 |
| data-to-dashboard | 90 | 28 |
| form-fill-batch | 90 | 21 |
| prospect-list-to-drafts | 90 | 16 |
| inbox-triage-drafts | 90 | 33 |
| study-notes-to-pdf | 90 | 26 |

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

Relevant: 29 of 90.

| repo | stars | licence | what it does | idea for which step |
|---|---|---|---|---|
| abi/screenshot-to-code | 80109 | mit | Turns screenshots, mockups and video into HTML/Tailwind/React/Vue with multi-model calls | variants (model fallback, asset reuse), polish (pixel check) |
| onlook-dev/onlook | 26891 | apache-2.0 | Visual editor that maps UI elements to Next.js/Tailwind source and edits them with AI | variants (element-to-source map), polish (sandbox preview) |
| emilwallner/Screenshot-to-code | 16534 | other | GRU model turning mockups into HTML/CSS (research code, last push 2024-08) | variants (reference only) |
| DouyinFE/semi-design | 10406 | other | React UI library with design tokens and a Design-to-Code workflow | variants (component source), polish (a11y check) |
| grab/cursor-talk-to-figma-mcp | 7047 | mit | MCP bridge that reads and writes Figma frames | directions (Figma input), polish (batch text edits) |
| ZSeven-W/openpencil | 6105 | mit | AI vector design tool; designs stored as JSON .op files, parallel agent teams | variants (structured design file, parallel parts) |
| leigest519/ScreenCoder | 3005 | apache-2.0 | Multi-agent screenshot to HTML/CSS: detect, map, generate | board (element detection), variants (layout mapping) |
| Anionex/agent-vision-toolkit | 1218 | mit | Vision tools for text-only LLMs: UI restoration, long-screenshot OCR | board, variants (intent-aware read), polish (verify-then-act) |
| mostafasadeghi97/design2code | 683 | mit | Design screenshot to responsive HTML/CSS/JS | variants |
| gridaco/assistant | 618 | other | Figma to modular Flutter and React code | variants (component detection) |
| Flame-Code-VLM/Flame-Code-VLM | 561 | apache-2.0 | Mockup to modular React via a vision-language pipeline | variants, pick (functional tests) |
| narnia-sh/layrr | 267 | mit | Maps a clicked browser element to its source file and line | polish (targeted edits) |
| s-smits/ui-screenshot-to-prompt | 236 | none listed | Screenshot to implementation prompt via OCR, OpenCV and an LLM | board (region slicing) |
| JochenYang/luma-mcp | 116 | mit | Vision MCP server: OCR, UI analysis, debugging for text-only models | variants (tile large images), polish (task routing) |
| intergalacticspacehighway/codesnap | 115 | none listed | macOS app turning UI screenshots into reusable components | variants |
| Mrxyy/screenshot-to-page | 104 | none listed | Screenshot or sketch to web page across several LLMs | variants (sketch input) |
| Leonxlnx/taste-skill | 93941 | mit | Agent skills that enforce type, spacing and motion rules against generic output | board (design-system map), polish (redesign audit) |
| GLips/Figma-Context-MCP | 15966 | mit | Trims Figma API data to layout and style facts for agents | directions (Figma context) |
| creativetimofficial/ui | 12076 | mit | shadcn-based component and block library | variants (block source) |
| max-sixty/worktrunk | 9071 | other | CLI for git worktrees with hooks, for parallel agents | variants (one worktree per direction) |
| superdesigndev/superdesign | 7077 | other | AI design agent: mockups and components from prompts, inside an IDE | variants (option count, preview) |
| bernaferrari/FigmaToCode | 5217 | gpl-3.0 | Deterministic Figma to HTML/Tailwind/Flutter/SwiftUI converter that flags ambiguous nodes | variants (rule-based output), pick (warnings) |
| benjitaylor/agentation | 4904 | other | Click-to-annotate UI feedback that outputs selectors and positions for agents | polish (mark regions), pick (structured notes) |
| Manavarya09/design-extract | 4190 | mit | Extracts tokens, layout, motion and voice from a live site via headless browser | board (reference tokens), polish (contrast score, drift check) |
| Jakubantalik/Libraries.dev | 4146 | mit | Copy-paste UI components for agents, with parameter prompts | variants (component prompts) |
| nraiden/openv0 | 3955 | mit | Multi-pass generative UI constrained to a component library | variants (library-constrained), polish (repeat passes) |
| JimLiu/baoyu-design | 4269 | mit | Design-engine skill with starter components and a preview-verify loop | variants (starter primitives), polish (verify loop) |
| shadcn-ui/lint | 3141 | mit | Agent-first linter for design-system rules, with fix messages | polish (auto-fix styling), variants (contracts) |
| southleft/figma-console-mcp | 2454 | mit | Bidirectional Figma API: extract, create and audit components | board (design-code parity), variants (component sets), polish (WCAG pass) |

Dropped (61): nexu-io/html-video, cirosantilli/china-dictatorship, skills/secure-code-game, study8677/awesome-architecture, riccardoperra/codeimage, gege-circle/.github, Commando-X/vuln-bank, 6551Team/claude-code-design-guide, perrypixel/10x-Tool-Calls, arturitu/the-delegation, proffesor-for-testing/agentic-qe, Hainrixz/open-carrusel, oncework/Codeexpander, matank001/cursor-security-rules, cirosantilli/china-dictatroship-7, morpheuslord/HackBot, Shreyas-29/luro-ai, huangjia2019/agent-design-patterns, haidrrrry/claude-remotion-skill (kept for footage), abusufyanvu/6S191_MIT_DeepLearning, Sfedfcv/redesigned-pancake, thehimel/cursor-rules-and-prompts, hypersocialinc/shots, Glade-tool/glade-mcp, HenryLach/taskplane, mRFWq7LwNPZjaVv5v6eo/cihna-dictattorshrip-8, panbinibn/OpenPacketFix_, Rizalcahdemak/akun-termux, Masudbro94/python-hacked-mobile-phone-, zhaixiansen1023-cpu/QR_Code_Scanner, SergioRibera/sss, zpc1314521/PCL2, P3GLEG/tauri-plugin-mcp, jddev273/windows-to-wsl2-screenshots, asgeirtj/system_prompts_leaks, systemdesign42/system-design-academy, deepset-ai/haystack, dyad-sh/dyad, plandex-ai/plandex, cobusgreyling/loop-engineering, trycompai/crm, deepseek-ai/3FS, firerpa/lamda, vynect/venom, KunAgent/Kun, ATH-MaaS/ComfyUI-Copilot, OpenBMB/AgentVerse, mvanhorn/cli-printing-press, Jakubantalik/transitions.dev, panaversity/learn-agentic-ai, David-patrick-chuks/Riona-AI-Agent, atopile/atopile, isjiamu/gzh-design-skill, dromara/liteflow, ombharatiya/ai-system-design-guide, AprilNEA/AChat, DingTalk-Real-AI/dingtalk-workspace-cli, CommandCodeAI/langui, Owl-Listener/designer-skills, Trystan-SA/claude-design-system-prompt, jau123/MeiGen-AI-Design-MCP

### Top ideas

1. **variants**: Give the variants agent a component registry to assemble from, not raw markup. Source: creativetimofficial/ui (block registry), Jakubantalik/Libraries.dev (parameter prompts), nraiden/openv0 (library-constrained generation).
2. **board**: Detect UI regions from the reference before any generation, and pass the list to each direction so all three start from the same layout map. Source: leigest519/ScreenCoder (element detection), s-smits/ui-screenshot-to-prompt (OCR and grid slicing).
3. **variants**: Use worktree hooks so each direction's worktree installs and starts its own dev server when spawned, instead of a hand-run setup per variant. Source: max-sixty/worktrunk (hooks).
4. **polish**: Lint the picked variant against design-system rules before the pick gate: reject arbitrary hex and px values and overrides of core component internals. Source: shadcn-ui/lint, with contrast scoring from Manavarya09/design-extract.
5. **pick**: Let the reviewer click the exact region that needs change and send its selector to the polish step, instead of describing it in prose. Source: benjitaylor/agentation, with narnia-sh/layrr to map the click to a source line.

### Hardening

1. **variants**: Parallel variants collide on ports and env files. Give each worktree its own port and env. Source: max-sixty/worktrunk (environment isolation).
2. **variants**: The model invents components, icons or imports that do not exist. Check every import against the registry and run a build before the variant goes to the pick gate. Source: nraiden/openv0 (validation pass), creativetimofficial/ui (peer-dependency checks), Jakubantalik/Libraries.dev (peer deps).
3. **variants**: Reference screenshots have missing or placeholder images, so the variant ships placeholders. Detect them and swap in cropped source assets. Source: leigest519/ScreenCoder (placeholder detection), abi/screenshot-to-code (asset extraction).
4. **variants**: Large or long reference screenshots exceed the model's input size and the request fails or truncates. Tile them with overlap and cap resolution first. Source: JochenYang/luma-mcp (multi-crop, compression), Anionex/agent-vision-toolkit (overlap merge in long-screenshot OCR).
5. **polish**: The polish pass breaks the layout or drops hover and active states that the picked variant had. Compare before and after renders (the odiff step already exists) and check interactive states. Source: abi/screenshot-to-code (visual regression), Manavarya09/design-extract (motion fidelity, drift check).

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

### Relevant repos (36)

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| assafelovic/gpt-researcher | 29,965 | apache-2.0 | sub-question decomposition, crawl, cited long-form report | decompose, draft |
| dzhng/deep-research | 19,771 | mit | iterative query generation and refinement loop | sweep, depth |
| nickscamara/open-deep-research | 6,294 | other | Firecrawl scraping plus reasoning model report | sweep, draft |
| 54yyyu/zotero-mcp | 5,290 | mit | search, read and cite papers in Zotero | sweep |
| Leonxlnx/unlazy | 3,876 | mit | depth-tree method and evidence gates | approve-plan, critic |
| jordan-gibbs/hyperresearch | 3,809 | mit | adversarial audit, fact-check and source verification | critic, cite-check |
| guy-hartstein/company-research-agent | 2,296 | apache-2.0 | LangGraph multi-agent, source-backed structured reports | draft |
| AnotiaWang/deep-research-web-ui | 2,223 | none listed | verifies findings against source excerpts | cite-check |
| HKUDS/Auto-Deep-Research | 1,749 | none listed | multi-step deep research on swappable LLMs | sweep, depth |
| RUC-NLPIR/WebThinker | 1,470 | mit | searches, navigates pages, drafts report inside reasoning | depth, draft |
| 917Dhj/DeepPaperNote | 1,164 | mit | extracts methods and evidence from papers into notes | depth |
| NVIDIA-AI-Blueprints/deep-researcher-agent | 885 | apache-2.0 | citation-backed reporting backend | draft, cite-check |
| Ayanami0730/deep_research_bench | 838 | apache-2.0 | evaluation benchmark for report quality | critics |
| DeepXiv/deepxiv_sdk | 804 | mit | structured citations over academic papers | sweep |
| qx-labs/agents-deep-research | 794 | apache-2.0 | Planner plus iterative gap-filling loops | decompose, depth |
| firecrawl/open-researcher | 688 | none listed | split-view analysis with automatic citations | draft |
| mjasnikovs/pi-task | 142 | agpl-3.0 | fixed refine, research, grill, compose, critique stages | decompose, critics |
| damionrashford/RivalSearchMCP | 132 | mit | multi-source search with conflict detection | sweep, critic |
| h4444433333/net-deep-research | 123 | mit-0 | source verification and structured evidence | cite-check |
| Aryan-Pardeshi/DeepResearch_AI | 94 | mit | evidence-grounded report with human approval gates | approve-plan, draft |
| extracurricular-ai/open-deep-research-with-web-ui | 73 | other | search engine fallbacks and parallel tasks | sweep |
| zoharbabin/web-researcher-mcp | 65 | mit | web search, full-page reads, verified citations (MCP) | sweep, cite-check |
| wheattoast11/openrouter-deep-research-mcp | 55 | mit | parallel research with consensus-backed synthesis | critics |
| LiXin97/agora-lab | 49 | apache-2.0 | adversarial meetings and paper-review gates | critics |
| blurryface13/asteria-agent | 43 | apache-2.0 | literature review, report writing, citation tracking | draft |
| wanshuiyin/Auto-claude-code-research-in-sleep | 17,163 | mit | cross-model review loops with automated verification | critics |
| InternLM/MindSearch | 6,938 | apache-2.0 | multi-agent deep search and synthesis | sweep, draft |
| synthetic-sciences/openscience | 3,950 | apache-2.0 | multi-agent research with human approvals | approve-plan |
| SamurAIGPT/llm-wiki-agent | 3,612 | mit | contradiction detection across sources | critic |
| blazickjp/arxiv-mcp-server | 3,202 | apache-2.0 | arXiv metadata and LaTeX section reading | sweep |
| mshumer/OpenDeepResearcher | 2,791 | mit | loop decides when evidence is enough | depth |
| Weizhena/Deep-Research-skills | 2,319 | mit | outline then investigation with human gates | approve-plan |
| TIGER-AI-Lab/OpenResearcher | 1,259 | none listed | long-horizon research framework and trajectories | depth |
| fastcrw/crw | 1,116 | agpl-3.0 | URL to clean markdown scraper | sweep |
| fdarkaou/open-deep-research | 875 | mit | iterative search, scrape, markdown report | sweep, draft |
| Johell1NS/browser-search | 529 | mit | SearXNG search tiers for browsing | sweep |

Dropped (54): khoj-ai/khoj, virattt/dexter, Alibaba-NLP/DeepResearch, arc53/DocsGPT, MiroMindAI/MiroThinker, zilliztech/deep-searcher, netease-youdao/LobsterAI, SkyworkAI/DeepResearchAgent, agentset-ai/agentset, Xiangyue-Zhang/auto-deep-researcher-24x7, rohunvora/x-research-skill, opencrabs/opencrabs, zamalali/DeepGit, DavidZWZ/Awesome-Deep-Research, VectorSpaceLab/general-agentic-memory, heurist-network/heurist-agent-framework, Haervwe/open-webui-tools, Haohao-end/openagent, vanthree31/PaperLens, petermartens98/GPT4-LangChain-Internet-Research-Agent-App, ahwurm/localharness, dovvnloading/Graphlink, Yogapriya2512/A-Simple-Chatbot-, vincenzo-afk/Intelis-Agent, FlowLLM-AI/finance-mcp, affaan-m/ECC, bytedance/deer-flow, xbtlin/ai-berkshire, GaiZhenbiao/ChuanhuChatGPT, microsoft/RD-Agent, browseros-ai/BrowserOS, 0x4m4/hexstrike-ai, MervinPraison/PraisonAI, KunAgent/Kun, deepchecks/deepchecks, simonlin1212/TradingAgents-astock, yilewang/llm-for-zotero, simonlin1212/Vibe-Research, szczyglis-dev/py-gpt, VoltAgent/awesome-ai-agent-papers, zi-yue-1129/DATAGEN, MaliosDark/wifi-3d-fusion, OpenOSINT/OpenOSINT, scadastrangelove/awesome-ai-security-tools, MLSysOps/MLE-agent, WecoAI/aideml, NPC-Worldwide/npcpy, Pokee-AI/PokeeResearchOSS, agents-flex/agents-flex, z0m31en7/Uscrapper, Mariewelt/OpenChem, 0xK3vin/MegaMemory, CopilotKit/open-multi-agent-canvas, harshaneel/humanize

### Top ideas

1. draft: every claim must carry a verbatim quote and a source id, and uncited sentences are cut before cite-check (deep-research-web-ui maps each claim to a snippet; net-deep-research grades claims A/B/C/U).
2. critic: flag numbers and dates that disagree across sources as a conflict list, not a silent pick (RivalSearchMCP conflict detection; llm-wiki-agent contradiction flags).
3. sweep: attach a reliability grade to each saved source and filter by domain tier before depth (net-deep-research source reputation; web-researcher-mcp search lenses for trusted domains).
4. cite-check: resolve each citation against authoritative metadata (DOI, arXiv id) before the quote check, so a made-up key fails early (arxiv-mcp-server BibTeX from arXiv records; DeepResearch_AI DOI resolution; zotero-mcp for the Zotero library).
5. approve-plan: show the six plan items and the depth each needs, and do not search until approved (Deep-Research-skills outline gate; DeepResearch_AI human gates; pi-task grill step).

### Hardening

1. sweep: rate limits and dead providers stop the run (dzhng/deep-research handles rate limits and concurrency; open-deep-research-with-web-ui and web-researcher-mcp fall back to a second search provider).
2. depth and patch: the gap loop never ends on a hard query (qx-labs agents-deep-research caps iterations and time; OpenDeepResearcher's sufficiency check stops it; agora-lab watchdog breaks repeat cycles).
3. draft and cite-check: a fabricated quote ships after the two patch rounds run out (hyperresearch blocks shipping when a quote fails; the pipeline should end the run with a visible failed-quote list, not a report).
4. sweep and critic: syndicated copies of one article count as three sources (hyperresearch syndication audit de-weights repeats; OpenDeepResearcher drops duplicate URLs).
5. sweep: a crash or timeout loses the whole run (open-deep-research-with-web-ui keeps the trace in SQLite; pi-task and agora-lab persist state per step, so a resume starts at the failed step).

## data-to-dashboard

### Relevant repos (28)

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| Canner/WrenAI | 17,827 | other | governed semantic layer for SQL and dashboards | plan, build |
| dataease/SQLBot | 6,874 | other | NL to SQL Q&A with visualisation | plan |
| Zafer-Liu/Data-Analysis-Agent | 2,613 | other | NL to SQL, charts and insights | plan, narrate |
| zi-yue-1129/DATAGEN | 1,808 | mit | state-managed analysis and report writing | narrate |
| helicalinsight/helicalinsight | 1,081 | agpl-3.0 | AI-assisted BI with dashboards | build |
| datagallery-ai/dataagent | 785 | apache-2.0 | governed, auditable multi-step data workbench | qa |
| zhongyu09/openchatbi | 666 | mit | NL to SQL, analysis and visualisation | plan |
| Wilson-ZheLin/Streamline-Analyst | 491 | mit | cleaning and preprocessing pipeline | clean |
| liangdabiao/claude-data-analysis | 441 | none listed | sub-agents for exploration, visuals and reports | clean, narrate |
| surendranb/google-analytics-mcp | 242 | mit | schema-aware GA4 data access | load |
| togethercomputer/open-data-scientist | 190 | mit | ReAct data exploration, code execution, report | plan |
| ellie886/Datalume | 135 | none listed | deterministic pandas maths under LLM reasoning | qa, narrate |
| VincenzoManto/Datacmd | 107 | mit | CSV/JSON to terminal dashboards | build |
| Rimagination/easyplot | 89 | mit | publication-ready figures from R and Python | build |
| Varn1t/EDAgent | 67 | none listed | automated EDA, cleaning and reporting | clean, qa |
| metabase/metabase | 49,591 | other | BI dashboards (reference) | build |
| antvis/mcp-server-chart | 4,393 | mit | 25+ chart types as an MCP server | build |
| StructuredLabs/preswald | 4,268 | apache-2.0 | packages Python, DuckDB and UI into one browser file | build |
| observablehq/framework | 3,660 | isc | static dashboards from data loaders | build |
| getnao/nao | 1,739 | other | analytics agents with context engineering | plan |
| rhiever/datacleaner | 1,078 | mit | missing values and categorical encoding | clean |
| dbt-labs/dbt-charts | 554 | apache-2.0 | declarative YAML KPI and dashboard definitions | plan |
| VisActor/VMind | 470 | mit | NL and CSV to interactive charts | build |
| nshiab/simple-data-analysis | 356 | mit | chainable DuckDB clean and analyse API | clean, qa |
| HKUSTDial/DataMagic | 298 | mit | data to narrated stories with recipe cards | narrate |
| hustcc/mcp-echarts | 269 | mit | generate, validate and export ECharts specs | build, readback |
| JasonObeid/Chart2Text | 161 | none listed | chart data to natural-language summaries | narrate |
| JetBrains/databao-agent | 157 | other | NL to SQL, dataframes and Vega-Lite | plan, build |

Dropped (62): netease-youdao/LobsterAI, cirosantilli/china-dictatorship, gege-circle/.github, eosphoros-ai/DB-GPT-Hub, aipoch/medical-research-skills, DEEP-PolyU/Awesome-LLM-based-Text2SQL, LeonChaoX/qinyan-academic-skills, cfahlgren1/natural-sql, opengeos/GeoAgent, antgroup/Agentar-Scale-SQL, premAI-io/premsql, Din829/DbRheo-CLI, cirosantilli/china-dictatroship-7, Oft3r/agentic-trading-desk, Sfedfcv/redesigned-pancake, arunpshankar/LLM-Text-to-SQL-Architectures, Anaconda-Labs/building-intelligent-apps-with-anaconda, mRFWq7LwNPZjaVv5v6eo/cihna-dictattorshrip-8, panbinibn/OpenPacketFix_, pragunbhutani/dbt-llm-agent, Text2SqlAgent/text2sql-framework, colossus-lab/openarg_backend, oooscoos/Benzi, zpc1314521/PCL2, EimanTahir027/100-AI-Agents-independent-projects, czyt1988/data-workbench, AstraZeneca/cellatria, Satissss/LinkAlign, jaakla/openmapstack-skills, Yangjiaxi/Sense, cameronking4/shadcn-openai-plaid-dashboard, whitew1994WW/AgenticDataAnalysis, arkaloscom/arkalos, ruvnet/GenAI-Superstream, gsaini/financial-research-analyst-agent, pingcap/tidb, apache/doris, databendlabs/databend, Arcenox-co/TickerQ, spiceai/spiceai, relation-graph/relation-graph, RamiAwar/dataline, tirrenotechnologies/tirreno, uasoft-indonesia/badaso, AlgoTraders/stock-analysis-engine, mariusandra/insights, alishobeiri/thread-notebook, frappe/insights, Canner/vulcan-sql, metabase/dataset-generator, n2ns/antigravity-panel, SkyCascade/SkyLearn, AOEpeople/aoe_technology_radar, mprove-io/mprove, Vanszs/qwencloud-generator, widestage/widestage, thvroyal/kimi-skills, XternA/income-generator, admin-dashboards/react-dashboards, jortilles/EDA, sandbaseai/sandbase-skills, bearlike/REMS-For-Organisations

### Top ideas

1. plan: define each KPI once with its metric, filter and join in a semantic layer, and have build read only those definitions (WrenAI MDL semantic layer; dbt-charts declarative YAML; databao-agent).
2. qa: recompute every headline number deterministically in SQL or pandas and compare it with the table, not with the LLM's own sum (Datalume deterministic pandas fallback; DataFoundry keeps the SQL trace for qa).
3. clean: run a deterministic pre-cleaner for types, dates, currency and blanks, then let the LLM handle only the leftovers (EDAgent two-pass cleaning; datacleaner imputation; simple-data-analysis chainable DuckDB steps).
4. build: emit the dashboard as one static, precomputed file, so readback opens a single page (preswald single-file export; Observable Framework precomputed snapshots).
5. readback: validate each chart spec before rendering, and check the chart type fits the data (mcp-echarts validate; dbt-charts validate; mcp-server-chart checks categorical data for bar charts).

### Hardening

1. load and qa: the agent writes a destructive query (WrenAI and openchatbi need a SQL guard that blocks DROP and DELETE; DataFoundry enforces read-only credentials on load).
2. clean: the raw table is too big for the context window and the agent loses rows (EDAgent passes only top correlations to the LLM; openchatbi caps rows returned to readback).
3. build: model-written Python for charts runs on the host (open-data-scientist runs code in Docker; Datalume allows only a whitelist of analysis functions).
4. load: the CSV changes shape between runs and the schema drifts (Data-Analysis-Agent validates schema before clean; Datacmd and preswald validate headers and types before build).
5. readback: a screenshot looks right while the printed number is wrong (DataMagic maps data values to visual labels and units before render; compare parsed page numbers with the table value).

## form-fill-batch

### Relevant repos (21)

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| magnitudedev/browser-agent | 4,134 | apache-2.0 | vision-first browser agent that fills web forms | fill |
| yinkaisheng/Python-UIAutomation-for-Windows | 3,585 | apache-2.0 | Python wrapper for Windows UI Automation | map, fill |
| open-rpa/openrpa | 3,087 | mpl-2.0 | RPA platform with UI interaction and workflow | fill |
| lahfir/agent-desktop | 1,779 | apache-2.0 | accessibility tree instead of pixels | map |
| robocorp/rpaframework | 1,574 | apache-2.0 | Python RPA libraries for web and desktop | fill |
| saucepleez/taskt | 1,369 | apache-2.0 | RPA with screen recording | fill |
| AmrDab/clawdcursor | 403 | mit | accessibility tree plus OCR UI map (MCP) | map |
| remorses/usecomputer | 337 | mit | screenshot and input CLI for agents | shot |
| mrpulor-gh/nuphus-mcp | 322 | mit | screen control MCP server | fill |
| congchuanling-dot/Cohort | 199 | mit | verifiable replays and tool-gate management | approve, confirm |
| ThePacielloGroup/aviewer | 164 | apache-2.0 | inspects MSAA and UI Automation trees | map |
| srikar-kodakandla/linkedin-easyapply-using-AI | 134 | apache-2.0 | LLM parses fields and fills application forms | map, fill |
| sbroenne/mcp-windows | 108 | mit | Windows UI Automation by element name and state (MCP) | map, fill |
| shanselman/FlaUI-MCP | 103 | mit | accessibility trees for Windows apps (MCP) | map, fill |
| trycua/cua | 29,107 | mit | sandboxed desktops and screenshots | shot |
| simular-ai/Agent-S | 12,567 | apache-2.0 | GUI agent framework (mouse, keyboard, screen) | fill |
| pywinauto/pywinauto | 6,204 | bsd-3-clause | Windows GUI automation library | fill, confirm |
| openai/openai-cua-sample-app | 1,889 | mit | computer-use loop with Playwright or PyAutoGUI | fill |
| AMAP-ML/LongHorizon-Harness | 1,704 | mit | plan, act, independently verify loop | fill, shot |
| mediar-ai/terminator | 1,652 | mit | deterministic steps plus AI recovery on Windows | fill |
| a-real-ai/pywinassistant | 1,341 | mit | Windows UIA instead of vision or OCR | map, fill |

Dropped (69): AirtestProject/Airtest, firerpa/lamda, KunAgent/Kun, netease-youdao/LobsterAI, Pinvou/pinvou-agent, skalesapp/skales, test-zeus-ai/testzeus-hercules, wzyn20051216/solidworks-automation-skill, e2b-dev/surf, zsims/hunt-and-peck, joshuar/go-hass-agent, LeonGaoHaining/opencowork, PM-Shawn/Abu-Cowork, tikmatrix/tikmatrix-desktop, robiot/AlphaClicker, robotcodedev/robotcode, cosscom/shipyard, Sfedfcv/redesigned-pancake, bagidea/bagidea-office, dragonked2/alphacode, EDEAI/OpenFlux, winyunq/UnrealMotionGraphicsMCP, dddabtc/winremote-mcp, Astro-Han/pawwork, madebyaris/native-cli-ai, Dyan-Dev/loopi, ImGoodBai/goodable, LAVARONG/wechat-automation-api, DeepFundAI/ai-browser, YV17labs/GhostDesk, DatafyingTech/Claude-Agent-Team-Manager, tfreitasleal/sharpRPA, sahajamit/promptwright, ceilf6/FrontAgent, michaljach/opencode-browser, zSynctic/AutoClicker, NanmiCoder/cc-haha, nanobrowser/nanobrowser, ntegrals/openbrowser, microsoft/fara, the-open-agent/openagent, Anil-matcha/open-dots, Marker-Inc-Korea/AutoRAG, yuruotong1/autoMate, TurixAI/TuriX-CUA, feder-cr/invisible_playwright_mcp, e2b-dev/open-computer-use, Hello-Mr-Crab/pywechat, szczyglis-dev/py-gpt, showlab/computer_use_ootb, showlab/ShowUI, trycua/acu, ghostwright/ghost-os, hyperbrowserai/HyperAgent, tinyfish-io/agentql, chen0416ccc-cpu/codex-windows-fast-patch-skill, OpenGVLab/ScaleCUA, kerpopule/hermes-jev-skills, vinyzu-archive/Botright, kangoka/tiktodv3, abshkbh/arrakis, itbrowser-net/undetectable-fingerprint-browser, xlang-ai/OpenCUA, suitedaces/computer-agent, agent-sh/computer-use-linux, oxylabs/agent-browser, techinz/playwright-captcha, noCaptchaAi/NoCaptcha-Ai-Browser-Extension, maximedrn/opensea-automatic-bulk-upload-and-sale

### Top ideas

1. map: read the window's UI Automation tree and match each sheet column to a field by its accessible name, not by position on screen (sbroenne/mcp-windows element names; FlaUI-MCP windows_snapshot; pywinauto backend='uia').
2. fill: set values through the element's value pattern or a stable element reference, and fall back to typing only when neither works (Python-UIAutomation ValuePattern; agent-desktop @id references; FlaUI ref selection).
3. shot: capture the form window alone for each row, so the approve gate sees the same thing the submit will send (usecomputer window-scoped screenshots; Python-UIAutomation CaptureToImage).
4. confirm: read every field back from the UI tree after fill and diff it against rows.json before the batch gate (FlaUI windows_get_text; Cohort acceptance-contract check).
5. fill and approve: write a replay log of every action and screenshot per row, so the batch approval has evidence to inspect (openai-cua-sample-app replay JSON; LongHorizon-Harness verified-state checkpoints).

### Hardening

1. captcha: the agent tries to get past a captcha instead of stopping. Keep the pipeline's hand-off to you; do not copy the captcha-solving repos (nuphus OCR and mcp-windows fallbacks are detection aids only, not solvers).
2. fill: a modal dialog hangs the call forever (FlaUI-MCP sets a 30 second timeout; Python-UIAutomation Exists(timeout) waits for an element before acting).
3. fill: keystrokes land in the wrong window after focus moves (pywinauto set_focus before typing; Python-UIAutomation SetTopmost; record the window handle per row in rows.json).
4. map and fill: a stuck key or a crashed loop leaves input held down (openai-cua-sample-app releases stuck keys after a crash; clawdcursor adds a kill switch and status banner you can use to stop the run).
5. shot and fill: the UI is still settling when the check runs (clawdcursor waits a settle window before verifying; terminator recovers from obscured elements with retries).

## prospect-list-to-drafts

### Relevant repos (16)

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| asiifdev/business-leads-ai-automation | 211 | mit | AI outreach content for prospects | write |
| PaulleDemon/Email-automation | 180 | other | Jinja2-personalised cold email campaigns | write, drafts |
| ethanplusai/harvey | 103 | mit | researches prospects and writes cold emails | hook, write |
| getaero-io/gtm-eng-skills | 65 | mit | lead enrichment waterfall skills | sources, hook |
| Atum246/keelead | 37 | mit | 62 data sources and email verification | sources, check |
| NightTrek/mistral-backlinker | 21 | none listed | contact scrape, company research, sales emails | sources, hook |
| SARAN-KUMAR-S/COLD-EMAIL-GENERATOR | 15 | mit | personalised emails with vector-stored context | write |
| austinchennn/cold-email | 13 | other | research recipients, tailored emails, Gmail | hook, drafts |
| hitb1099/outreach-os | 12 | mit | discovery, scoring and follow-up sequences | load |
| dancolta/trustpilot-outreach-automation | 12 | none listed | reviews turned into drafts through an outreach profile | hook, write |
| outreachmagic/outreachmagic | 11 | mit | outbound data layer and email verification | check |
| alphaparkinc/genpark-sales-email-personalization-engine-skill | 9 | none listed | personalised cold outreach engine | write |
| 434media/bizdev-agent | 9 | none listed | scrapes company sites into a CRM | sources |
| alphaparkinc/genpark-cold-outreach-deliverability-spam-sanitizer-skill | 8 | none listed | checks outreach copy against spam filters | check |
| alexandertiopan1212/AI_Email_Crafter | 6 | none listed | personalised outreach saved as Gmail drafts | drafts |
| SnehaDeshmukh28/SmartEmail-Personalizer-Agent | 5 | none listed | CSV to personalised emails | write |

Dropped (74): omkarcloud/google-maps-scraper, Mahanaicoach/google-maps-scraper-kit, kiryano/Scout, Madi-S/Lead-Generation, worldscraping/google-maps-scraper, linkdAPI/linkedin-leads-discover, eeshsaxena/outreach-emails, prantikmedhi/b2b-leads-ai, LLMbreaker/awesome-ai-sales-tools, muzammildafedar/udayah, openmindsclub/algeria-b2b-lead-scraper, Schlaflied/job-autopilot, avayabaniya/job-cd, PatrykIA/High_Lead_Generation_Automation_Tool, eyobbokru/Lead-generation-linkedin, Anmol-Baranwal/hndigest, GiacomoSaccaggi/getmailsfromPagineGialle, akahappygit/AI-Lead-Voice-Automation, codiebyheaart/sales-lead-scraper-tool, SURESHBEEKHANI/Cold-Email-Automations, williamswarren/LinkedIn-Web-Scraper, FenrirDWolf/Google-Map-Scraper, badroumari/linkedin_email_scraper, abhiram0709/Cold-Mail-Automation-Using-N8N-With-Brevo-CRM, IJustWantAJob/outbound-email-automation, aniket1251/outly, ipushin/Scraping-and-Analysing-real-estate-transactions, jessjohn1539/Google-Maps-Lead-Scraper-using-Selenium, Shaamiilll/startup-india-scraper, awais2iv/Social-Lead-Automation, api-evangelist/gojiberry-ai, ndpvt-web/ai-sales-agent-simulator, avrtt/mailman, Danish08654/AI-Sales-Intelligence-System, frappe/erpnext, nocobase/nocobase, krayin/laravel-crm, illacloud/illa-builder, trycompai/crm, idurar/idurar-erp-crm, Dolibarr/dolibarr, gosom/google-maps-scraper, openblocks-dev/openblocks, SuiteCRM/SuiteCRM, joeyism/linkedin_scraper, melgarafael/DeskcommCRM, speedyapply/JobSpy, frappe/crm, espocrm/espocrm, eracle/OpenOutreach, ONLYOFFICE/CommunityServer, InvoicePlane/InvoicePlane, metasfresh/metasfresh, Django-CRM/Django-CRM, Bottelet/DaybydayCRM, WuKongOpenSource/Wukong-AICRM, open-mercato/open-mercato, relaticle/relaticle, dwijitsolutions/laraadmin, WebVella/WebVella-ERP, asyraffff/Open-Source-Ruby-and-Rails-Apps, apache/ofbiz-framework, oroinc/crm-application, directus-labs/agency-os, ChurchCRM/CRM, elm1nst3r/GHOST-osint-crm, josephlimtech/linkedin-profile-scraper-api, graniet/operative-framework, linvo-io/linvo-scraper, linkedtales/scrapedin, ScrapingBee/google-reviews-scraper, mishakorzik/MailFinder, Taoviqinvicible/Tools-termux, austinoboyle/scrape-linkedin-selenium

### Top ideas

1. hook: pick prospects whose own page shows a checkable gap (missing schema, stale blog, empty team page) before writing, so the one fact is real (harvey signal filters; gtm-eng-skills signal discovery).
2. sources: run a provider waterfall with dedupe, falling to a second provider only when the first returns nothing (gtm-eng-skills provider waterfall; keelead multi-source aggregation).
3. check: verify each contact's domain (MX record) and drop disposable or dead domains before any draft is written (keelead MX and disposable-email layers; outreachmagic waterfall verification).
4. check: run a deterministic lint on every email before the LLM check: under 100 words, no unfilled braces, no spam trigger words (genpark deliverability sanitizer; PaulleDemon Jinja2 rendering to catch undefined variables).
5. drafts: give each prospect a state (Pending, Drafted, Saved) so a re-run skips finished rows (outreach-os status state machine; austinchennn SQLite sent tracking; AI_Email_Crafter saves as Draft, never Send).

### Hardening

1. sources: sites rate-limit or block the fetch (trustpilot-outreach staggers requests at randomised intervals; austinchennn uses exponential backoff; bizdev-agent rotates user agents and sets timeouts).
2. write: the email invents a detail about the prospect (genpark personalisation flags hallucinated facts; gtm-eng-skills checks the right person and company before drafting).
3. hook: the wrong person or company gets the email (gtm-eng-skills identity validation; check the persona and title match before write).
4. drafts: a second run duplicates drafts in Gmail (outreach-os and austinchennn record sent or drafted status; check Gmail for an existing draft by recipient before create).
5. load and approve-spend: a huge list burns the lookup budget (harvey shows a costed estimate before heavy research; cap pages per site with the max_pages input and show the count at the gate).

## inbox-triage-drafts

### Relevant repos (33)

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| elie222/inbox-zero | 12,435 | other | AI email organisation, drafting and filtering | classify, draft |
| cloudflare/agentic-inbox | 8,231 | apache-2.0 | self-hosted email client with agent drafting | draft, drafts |
| herald-email/herald-mail-app | 144 | other | terminal mail client with AI triage | classify |
| AgriciDaniel/claude-email | 130 | mit | AI triage and copywriting suite | classify, draft |
| fazlerocks/jevmail | 93 | mit | sorts Gmail into trays by category | classify |
| jacob-dietle/Autonomous-Sales-Inbox-and-CRM-Assistant | 55 | agpl-3.0 | classifies mail and drafts brand-consistent replies | classify, draft |
| Ha22yX/auto-email-system | 51 | mit | triage, summary and priority queues | classify |
| leeguooooo/mail-use | 43 | mit | JSON mail interface with built-in safety | fetch, drafts |
| ZackAkil/AI-got-this-gmail-delegator | 23 | none listed | categorises mail and drafts from a knowledge base | classify, draft |
| darinkishore/Inbox-MCP | 21 | none listed | email triage MCP server | fetch |
| talalakkari/agentic-cal | 18 | apache-2.0 | email and calendar triage via MCP | classify |
| navbuildz/gmail-mcp-server | 15 | mit | multi-account Gmail read, write and archive (MCP) | fetch, drafts |
| Ishabdullah/Aigentik-CLI | 14 | mit | local-LLM Gmail triage | classify |
| stonefullstm/ai-email-triage | 13 | mit | heuristics, embeddings, then LLM fallback cascade | classify |
| aziruhq/aziru | 9 | agpl-3.0 | taxonomy triage with drafts needing approval | classify, drafts |
| henry200803/mailbridge | 9 | mit | mailbox search, read and draft (MCP) | drafts |
| alphaparkinc/genpark-autonomous-inbox-triage-email-dispatcher-agent-skill | 8 | none listed | autonomous triage and reply generation | classify, draft |
| alphaparkinc/genpark-instant-inbox-zero-email-triage-synthesizer-skill | 8 | none listed | instant inbox-zero triage | classify |
| astetic-dev/porter-intake-operator | 7 | mit | rubric-based triage into drafted replies | rules, classify |
| Rajat25022005/Intelligent-Mail-Assistant | 7 | none listed | local Ollama triage with RAG replies | classify, draft |
| KrishT97/MailSift-AI | 6 | other | spam and priority scoring model | classify |
| paabloLC/gmail-ai-draft | 6 | mit | webhook-driven Gmail draft generation | fetch, draft |
| alexandertiopan1212/AI_Email_Crafter | 6 | none listed | outreach drafts saved to Gmail | drafts |
| maillifier/maillifier | 6 | mit | draft replies in an agent account | draft |
| sryo/GmailTidy | 6 | gpl-3.0 | Apps Script labels, drafts, follow-up reminders | rules, drafts |
| kl3inIT/zero-mail | 5 | mit | rule-based triage and drafts | rules |
| mohsinsheikhani/property-maintenance-agent | 5 | none listed | eval framework: code graders, LLM judge, CI gates | check |
| Foundry376/Mailspring | 17,898 | gpl-3.0 | mail rules engine | rules |
| langchain-ai/agents-from-scratch | 2,375 | mit | LangGraph email assistant with human-in-the-loop | classify, draft, check |
| brekkylab/backlot | 415 | mit | local emulator of SaaS APIs for tests | check |
| jeremyephron/simplegmail | 411 | mit | Gmail API drafts and filters | drafts |
| kaymen99/langgraph-email-automation | 278 | none listed | categorise, draft and verify replies with RAG | classify, draft, check |
| asweigart/ezgmail | 273 | gpl-3.0 | Gmail API wrapper | fetch, drafts |

Dropped (57): kaymen99/AI-Voice-assistant, mypaios/mypaios, Drlordbasil/groq-gmail-assistant, atxp-dev/atxp, sannabotdev/sannabotapp, seanfromthepast/ATAT, BrisaAnahiEscobar/mailflow, ng-galien/maket, CLoaKY233/MIST, highhands89/seny-executive-assistant, pulzeai-oss/chrome-ai-assistant, Trinhvhao/n8n-rag-automation-chatbot, Ejb503/systemprompt-mcp-gmail, Albretsen/MCPEmails, tonykipkemboi/gmail-imap-mcp, atlyslabs/gideon, Ajitesh1405/knot, 0xgetz/arena-auto-chat, Airmail/airmail-mcp, ascarola/verdictmail, holoduke/myagent, tubone24/mugi-claw, benmoir-bilue/ben-mutt, novuhq/novu, enescingoz/awesome-n8n-templates, macro-inc/macro, eracle/OpenOutreach, ghostwright/phantom, firecrawl/fire-enrich, mikehasa/golive-skill, KroMiose/nekro-agent, hkdb/aerion, TryCaspian/caspian-sdk, landy22granatt/Kumpulan-Script-Termux, pazz/alot, OpenClaudia/openclaudia-skills, KeyID-AI/agent-kit, Taoviqinvicible/Tools-termux, Lifecycle-Innovations-Limited/claude-ops, haoruilee/awesome-agent-native-services, markrai/scrumboy, uday-khan/Termux, abhishekkr/gmail-helper, chekusu/mails, zszszszsz/.config, inboundemail/inbound, KeyID-AI/sdk-js, wong2/cf-mailroom, theexperiencecompany/gaia, sayantann11/all-classification-templetes-for-ML, KeyID-AI/sdk-py, remorses/zele, Vanszs/qwencloud-generator, Atomic-Mail/atomic-mail-agentic, truespar/sentio, agenticmail/agenticmail, Rizalcahdemak/akun-termux

### Top ideas

1. classify: run deterministic rules first (sender, unsubscribe, noreply, newsletter headers) and call the LLM only for what is left (ai-email-triage heuristics then embeddings then LLM; Aigentik rule pre-processing).
2. classify: store a confidence and the top two labels per message, and send low-confidence items to the check gate instead of guessing (jevmail top-two probabilities; porter-intake-operator stop conditions and no-guess policy).
3. fetch: use read-only mail scopes and fetch only since the last run, with a content hash to skip mail already seen (aziru read-only scopes; ai-email-triage HashCache; gmail-ai-draft watch and retry handling).
4. draft: create drafts only, with a confirm flag on any send or delete path (agentic-inbox human confirmation; mailbridge confirm=true; aziru draft-only).
5. check: verify each reply against its own thread: same thread id, answers the open ask, promises nothing new (langgraph-email-automation relevance check; simplegmail reply_to for thread headers; agents-from-scratch tool-call validation).

### Hardening

1. classify: an email body tells the agent to act (prompt injection). Keep the pipeline rule that mail text is data, and strip or sandbox HTML first (auto-email-system renders untrusted HTML in a sandboxed iframe).
2. fetch: an empty result is read as no mail when the fetch actually failed (mail-use reports empty versus failed as separate codes; enforce a strict JSON error contract).
3. draft: two runs answer the same thread twice (gmail-ai-draft keeps processed state; GmailTidy pings once per thread; gmail-mcp labels handled mail).
4. fetch: the push watch expires and new mail is missed (gmail-ai-draft handles watch expiry; aziru falls back to polling).
5. draft: the reply uses the wrong tone or ignores the earlier messages (Inbox Zero style-matching against past sent mail; mailbridge get_thread for full history before drafting).

## study-notes-to-pdf

### Relevant repos (26)

| repo | stars | licence | what it does | idea for which step |
|---|---:|---|---|---|
| microsoft/markitdown | 189,128 | mit | office and PDF to Markdown | ingest |
| datalab-to/marker | 40,308 | apache-2.0 | PDF to Markdown keeping layout, tables, math | ingest |
| firecrawl/anydoc | 22,642 | mit | office documents to Markdown | ingest |
| firecrawl/pdf-inspector | 19,554 | mit | classifies scanned vs text PDFs | ingest |
| iamgio/quarkdown | 16,303 | gpl-3.0 | Markdown with layouts and PDF or slide export | export |
| Wandmalfarbe/pandoc-latex-template | 7,273 | bsd-3-clause | LaTeX template for Markdown to PDF | export |
| CatchTheTornado/text-extract-api | 3,182 | mit | local OCR for scanned slides via Ollama | ingest |
| chatdoc-com/OCRFlux | 2,533 | apache-2.0 | PDF tables merged across pages | ingest |
| MarkPDFdown/markpdfdown | 2,295 | apache-2.0 | multimodal LLM PDF to Markdown | ingest |
| themsaid/ibis | 2,010 | mit | Markdown to themed books with TOC | export |
| simonhaenisch/md-to-pdf | 1,966 | mit | Markdown to PDF via Marked and Puppeteer | export |
| realdennis/md2pdf | 1,841 | mit | offline Markdown to PDF editor | export |
| elipapa/markdown-cv | 1,499 | mit | CSS styling for print output | export |
| wisupai/e2m | 1,294 | apache-2.0 | many file types to Markdown | ingest |
| fraserxu/electron-pdf | 1,292 | mit | HTML and Markdown to PDF | export |
| yigitkonur/api-llm-ocr | 902 | other | vision OCR for PDF tables | ingest |
| Blueturboguy07/NitroAI | 133 | agpl-3.0 | notes, flashcards and quizzes from PDFs | notes |
| karthikkasirajan/studybuddy-ai | 54 | none listed | PDF to quizzes and study material | notes |
| vincenzo-afk/PenFlow | 23 | none listed | study material to notebook-style pages | notes |
| yukunou703/studyproof | 20 | mit | audits AI quotes against source text | check |
| Manumarzo/AudioTTo | 19 | mit | slides to LaTeX study notes | notes |
| EricKart/AI901-Study-Kit | 12 | none listed | notes, slides and PDFs from source docs | notes, export |
| suran-jeet/ExamPrep-AI | 10 | none listed | PDF notes to study material via Ollama | notes |
| ZelinZhou-THU/lecture-notes-creator | 7 | apache-2.0 | MinerU extraction plus AI review loop | notes, check |
| AgriciDaniel/claude-obsidian | 15,420 | mit | sources to provenance-aware linked graph | outline |
| fnando/kitabu | 687 | mit | Markdown to PDF via Prince engine | export |

Dropped (64): lowlighter/metrics, joeseesun/qiaomu-anything-to-notebooklm, danburzo/percollate, cirosantilli/china-dictatorship, alanshaw/markdown-pdf, vsch/flexmark-java, chrisryugj/kordoc, gege-circle/.github, visionmedia/masteringnode, jzillmann/pdf-to-markdown, SakuraMathcraft/LaTeXSnipper, adithya-s-k/marker-api, flyhunterl/flymd, x-cod3r/Ai-Anki-Generator, Erick-Bryan-Cubas/green-deck, gong1414/anki-card-skill, Panth1823/FlashGenie, umeshSinghVerma/Youtube-study-kit, sizwinz/StudySage-Offline-Online-AI-Note-Assistant, code-with-idrees/Google-Meet-AI-Attendence-Agent, mrunalg141/studymate, GrannyProgramming/remnote-flashcard-generator, FrostySL/anki-card-forge, FlashGenie/genie-app, akramlatif/ai-smart-study-system, rajdhakad9826/coursera-scraper, donnemartin/system-design-primer, donnemartin/interactive-coding-challenges, ankitects/anki, ankidroid/Anki-Android, 5mdld/anki-jlpt-decks, Natively-AI-assistant/natively-cluely-ai-assistant, tianshanghong/awesome-anki, ObsidianToAnki/Obsidian_to_Anki, team-reflect/reflect-open, superlinear-ai/raglite, anki-geo/ultimate-geography, berylliumsec/nebula, reuseman/flashcards-obsidian, badlydrawnrob/anki, blueberrycongee/Lumina-Note, Ajatt-Tools/mpvacious, thiswillbeyourgithub/AnkiAIUtils, ad-si/Coding-Flashcards, louietan/anki-editor, briansunter/logseq-openai, open-spaced-repetition/free-spaced-repetition-scheduler, Radiant303/SpringNote, Troyciv/anki-templates-superlist, pranavdeshai/anki-prettify, thiswillbeyourgithub/wdoc, ankimcp/anki-mcp-server, Dhravya/notty, xiao18825501901-rgb/coursemate-ai, alyssaxuu/carden, tema6120/ForgetMeNot, ayorgo/leetcode-neetcode-anki, rampaa/JL, 2anki/2anki.net, ymx10086/ResearchClaw, raine/anki-llm, helixnow/deep-student, antigluten/amgi, taivop/anki-decks

### Top ideas

1. ingest: classify each PDF as text or scanned and OCR only the scanned pages (pdf-inspector selective OCR; marker digital-versus-scanned routing).
2. notes: every line carries a slide cite, and check fails any slide that no line cites (studyproof quotation audit; lecture-notes-creator page-driven structure accounts for every slide).
3. check: audit each quote against the slide text, and mark unverifiable lines instead of keeping them (studyproof unverified status; claude-obsidian claim ledger linking each fact to its source id).
4. export: drive the PDF from one Markdown file with paged print CSS, not browser defaults (kitabu Prince paged output; markdown-cv print media queries; Eisvogel LaTeX template for headers and footers).
5. outline: map modules to slide ranges first, so a missing topic is visible before any notes are written (EricKart curriculum mapping; lecture-notes-creator page-driven structure).

### Hardening

1. export: a table or worked example splits across a page break (md-to-pdf page-break handling; kitabu font and layout checks before export).
2. ingest: OCR garbles tables and maths, or repeats headers across pages (marker re-processes low-confidence blocks; OCRFlux merges cross-page tables and removes repeated headers).
3. export: the PDF step fails on a machine with no LaTeX or Chrome (kitabu runs a dependency check first; Eisvogel's Docker image gives a fallback; md-to-pdf needs Puppeteer installed).
4. check: an unsourced line survives the rewrite-once rule (studyproof marks it unverified; claude-obsidian lint catches orphans and dead links before proof).
5. notes and proof: a failed proof pass leaves print.css half-edited and the PDF overwritten (claude-obsidian restores the last known-good file on failure and applies changes as one bundle).
