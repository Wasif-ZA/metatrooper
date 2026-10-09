# MetaTrooper launch terms check, 2026-10-09

Raw pages are in `terms/`. Quotes are exact. Search note: Exa hit its free rate limit after two queries, so pages were read straight from the vendor URLs via Jina.

## 1. Anthropic

Claude Code docs, legal and compliance (https://code.claude.com/docs/en/legal-and-compliance):

- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens"
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under _Can customers offer Claude Code in their products?_ above."
- "The Claude Code binary must not be modified." and "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential"
- Scope of that section: "preinstalling or running Claude Code in your products or services ... requires agreeing to our Commercial Terms of Service and complying with the conditions below"
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- Name and logo: "You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product. Any other use of Anthropic's names or logos ... requires our written permission."

Usage Policy (https://www.anthropic.com/legal/aup):
- Prohibited: "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used"

Consumer Terms (https://www.anthropic.com/legal/consumer-terms), section 3 prohibited uses:
- "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
- "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else."
- "To develop any products or services that compete with our Services ... or resell the Services."

Commercial Terms (https://www.anthropic.com/legal/commercial-terms) D.4: "Customer may not ... access the Services to build a competing product or service, including to train competing AI models or resell the Services except as expressly approved by Anthropic". Applies to API keys, not to a Pro/Max login.

Agent SDK and `claude -p` billing (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan, read 2026-10-09):
- "Update June 15, 2026: We've paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits."
- "Update October 7, 2026: Claude Max and Team plans now include monthly API credits, which cover the Claude Agent SDK, `claude -p`, the Claude API, and Claude Managed Agents. You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."
- So the 2026-06-15 separate-credit change did NOT take effect (paused the same day, per New Stack via daily.dev, 2026-06-16). The word "For now" means it can return.

Trademark Guidelines (https://www.anthropic.com/legal/trademark-guidelines): "You may only use our trademarks as specifically permitted by us and only in materials we approve beforehand." "We will supply an image (or images) of the trademark(s) for your use ... No alterations ... are permitted." "You may not use our trademarks in a manner that implies Anthropic's sponsorship or endorsement".

Reading:
- Interactive launch of the user's own unmodified `claude`, user signs in themselves, MetaTrooper holds no credentials: fits the explicit carve-out. It does not route, resell or proxy.
- Open edge: Consumer Terms 3.7 bans "automated or non-human means ... bot, script". Interactive Claude Code is Anthropic's own client, so the ban is probably not aimed at it, but a script that types prompts into the terminal with no human (the Pro fix step) is the grey zone. Anthropic's docs do not say.
- Open edge: the AUP line "services that route requests through consumer subscriptions" is aimed at proxies. A paid plugin that makes Claude do work on the buyer's own subscription is not that, but no clause blesses it.

Verdict, free app: ALLOWED WITH CONDITIONS. Conditions: launch the unmodified official binary; user authenticates themselves; never read, store or forward OAuth tokens or session files; no `claude -p` or SDK; no sharing of one login across people.
Verdict, Pro: UNCLEAR. The fix loop is unattended Claude Code on a consumer plan, sold for money. If shipped: keep the fix step in the interactive binary with the user present or approving; say in the listing that the buyer's own plan is used and Pro adds no Claude access; ask Anthropic (sales contact in the docs) before charging. Fallback: API-key auth for the Claude fix step, which is the documented path for products.

## 2. OpenAI

Terms of Use (https://openai.com/policies/row-terms-of-use/): you may not "Automatically or programmatically extract data or Output", and "You may not share your account credentials or make your account available to anyone else". Aimed at scraping ChatGPT, not at the Codex CLI.

Codex non-interactive docs (https://developers.openai.com/codex/noninteractive):
- "Non-interactive mode lets you run Codex from scripts (for example, continuous integration (CI) jobs) without opening the interactive TUI."
- "`codex exec` reuses saved CLI authentication by default."
- "API keys are the right default for automation because they are simpler to provision and rotate. Use this path only if you specifically need to run as your Codex account."

CI auth guide (https://developers.openai.com/codex/auth/ci-cd-auth): "This is an advanced workflow for enterprise and other trusted private automation." "Do not use this workflow for public or open-source repositories." "only one machine or serialized job stream will use a given `auth.json` copy"

Auto-review / "Approve for me" (https://developers.openai.com/codex/sandboxing/auto-review): documented and supported: "set `approvals_reviewer = "auto_review"` with an eligible interactive approval policy". "Auto-review is a reviewer swap, not a permission grant."

Auth page (https://developers.openai.com/codex/auth): "Treat `~/.codex/auth.json` like a password: it contains access tokens. Don't commit it, paste it into tickets, or share it in chat." and "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs."

Third-party apps on a ChatGPT plan (https://developers.openai.com/siwc/token-sharing-open-source): "ChatGPT plan usage is an optional capability within Sign in with ChatGPT. In addition to identity scopes, your open-source app can request permission to use the user's ChatGPT plan for eligible Responses API requests." and "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form". This is OpenAI's sanctioned route for apps that call the API directly. MetaTrooper spawns the CLI instead, so it does not use it, but it shows OpenAI welcomes third-party tools on a user's plan (paid ones via a form).

Brand (https://openai.com/brand/): "Use the logo only when it directly relates to OpenAI services." Don't "Misrepresent your relationship with OpenAI, imply endorsement, or confuse users about sponsorship." Don't "Use the logo more prominently than your own or in unrelated contexts." "By using our logos, you agree to our Marks usage terms." "All co-branded materials must undergo an approval process by both brands". Wordmark: no stretching, cropping, effects.

Reading: Codex CLI is built to be scripted, and the user's own `codex login` session is the default for `codex exec`. No clause bars a third-party tool from launching the user's CLI. The docs steer automation to API keys and warn off public or open-source repos for ChatGPT-managed CI auth; a desktop app on the user's own machine is not a CI runner.

Verdict, free app: ALLOWED WITH CONDITIONS. Conditions: spawn the real `codex` binary on the user's machine; never copy or read `auth.json`; one machine per login; no hosted or shared runners; logos per section 4.
Verdict, Pro: ALLOWED WITH CONDITIONS. Same, plus the buyer's own login only, no pooling, and offer an API-key option because the docs call it "the right default for automation". Optional: file OpenAI's paid-app interest form.

## 3. Google (Antigravity CLI, Gemini CLI)

Antigravity Additional Terms (https://antigravity.google/terms), clause 6:
- "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using the Service in connection with products not provided by us. Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."
- Clause 4: "AI Agents ... perform actions or tasks on your behalf in a supervised or autonomous manner that you may create, orchestrate, or initiate within the Service ... You are solely responsible for: (a) the actions and tasks performed by an AI Agent".

Gemini CLI terms (https://geminicli.com/docs/resources/tos-privacy/): "Directly accessing the services powering Gemini CLI ... using third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth) is a violation of applicable terms and policies."

Antigravity CLI headless docs (https://antigravity.google/docs/cli/headless): "Run Antigravity CLI non-interactively to script agent tasks, integrate with CI pipelines, and capture machine-readable output." "Headless mode (also called print mode) ... Pass a prompt with `-p` (or its aliases `--print` and `--prompt`)". "Headless mode uses your cached credentials. Authenticate once with an interactive `agy` session first." It also documents `--input-format stream-json` for a host script to drive the CLI.

Google Terms (https://policies.google.com/terms): "You must not abuse, harm, interfere with, or disrupt our services or systems".

Reading: the named breach is third-party software accessing the Service with Antigravity OAuth. Driving Google's own `agy` binary through its documented `-p` is the first-party client doing the access, and Google documents scripting it. But "using the Service in connection with products not provided by us" is broad, and a paid orchestrator is such a product. The named examples (OpenClaw with OAuth) are token reuse, which MetaTrooper does not do.

Verdict, free app: ALLOWED WITH CONDITIONS. Conditions: call only the real `agy` binary through documented flags; never touch its OAuth tokens; user signs in interactively first.
Verdict, Pro: UNCLEAR. Clause 6 has no carve-out for a paid wrapper around the official CLI. Ask Google (antigravity-support@google.com, or discuss.ai.google.dev, both named in the terms) or give Pro a Gemini API key path.

## 4. Logos in the README

- Anthropic/Claude: logos need written approval and must be supplied by Anthropic. Plain text "runs Claude Code" is explicitly fine. Verdict: NOT ALLOWED as a logo without permission; ALLOWED as plain text.
- OpenAI: allowed only "when it directly relates to OpenAI services", unaltered, not more prominent than your own, no implied endorsement, under the Marks usage terms. Verdict: ALLOWED WITH CONDITIONS (small, unaltered, "works with" label, MetaTrooper larger, not-affiliated line).
- Google/Gemini: Google logo page says "Don't use the Google logo in marketing materials for a business or to imply endorsement from Google" and "Don't combine your logo with Google's or modify the Google logo in any way". No public Gemini logo page found (about.google/brands/google-gemini/ returned 404; full guidance sits behind Partner Marketing Hub sign-in). Verdict: UNCLEAR, treat as NOT ALLOWED.
- Safe default for all three, free and Pro: text names only ("Works with Claude Code, Codex CLI, Antigravity CLI") plus "MetaTrooper is not affiliated with or endorsed by Anthropic, OpenAI or Google." The Pro listing is commercial, so keep it text-only there for certain.

## Summary table

| Vendor | Free app | Pro (A$19) |
|---|---|---|
| Anthropic | ALLOWED WITH CONDITIONS | UNCLEAR |
| OpenAI | ALLOWED WITH CONDITIONS | ALLOWED WITH CONDITIONS |
| Google | ALLOWED WITH CONDITIONS | UNCLEAR |
| Logos | text only | text only |

## Questions to send before Pro charges anyone (M5-D26)

### To Anthropic (sales contact on the Claude Code legal and compliance page)

Subject: Paid open-source tool that launches the user's own Claude Code

Hello. I build MetaTrooper, an open-source (AGPL) Windows desktop app. It starts the official, unmodified Claude Code
binary in a terminal on the user's own machine, and the user signs in with their own Claude plan. MetaTrooper never
reads, stores or forwards credentials, and it never uses `claude -p` or the Agent SDK.

I plan a paid plugin (about A$19 a month). It reviews a pull request with two other tools and then asks the user's
Claude Code session to fix the findings in a git worktree. The user starts each run and approves before anything is
pushed. Claude usage stays on the user's own plan; the plugin sells no Claude access.

Is that use within the Consumer Terms and the Usage Policy? If not, is the right path that the paid plugin runs the
Claude step only on the user's own Anthropic API key?

Thank you, Wasif Zaman

### To Google (antigravity-support@google.com)

Subject: Third-party desktop app that runs the official agy CLI

Hello. I build MetaTrooper, an open-source (AGPL) Windows desktop app. It runs the official `agy` binary on the user's
own machine through its documented print mode (`agy -p`), after the user has signed in interactively. MetaTrooper
never reads or reuses Antigravity OAuth tokens.

Clause 6 of the Antigravity Additional Terms names third-party software accessing the Service as a breach. Does that
cover a desktop app that only launches the official CLI? I also plan a paid plugin (about A$19 a month) that uses the
CLI for code review on the buyer's own account. Is that allowed, or should the paid plugin use a Gemini API key
instead?

Thank you, Wasif Zaman
