# Platform rules for cc drafts

Checked 2026-11-18. Recheck each destination before using a draft. Product facts come only from this repo's `README.md` and root `package.json`: cc is version 0.1.0, Windows only, installed from source, and pre-release. cc is not affiliated with or endorsed by Anthropic, OpenAI, or Google.

## Reddit

Reddit's public rules pages did not expose full sidebar text in this check. The notes below use moderator announcements, removal notices, and the community's rule acknowledgment where available. Flair menus and submission controls may differ for signed-in users. Reddit says community rules appear in the sidebar or the mobile About tab. [Reddit posting help](https://support.reddithelp.com/hc/en-us/articles/360060422572-How-do-I-post-and-comment-on-Reddit).

### r/ClaudeAI

- Self-promotion: Rule 7 allows a project showcase when Claude or Claude Code is central, the author explains what they built and how Claude helped build it, the base project is free to try, and the post avoids marketing copy and affiliate links. A moderator notice also accepts a project specifically for Claude. The repo README does not establish that Claude helped build cc, so do not claim that. [Moderator rule update](https://www.reddit.com/r/ClaudeAI/comments/1qe5wtt/rule_7_is_getting_a_glowup_less_spam_more_how_the/), [recent moderation notice](https://www.reddit.com/r/ClaudeAI/comments/1xsffby/removed/).
- Flair: `Showcase` is used for project posts in recent moderation notices. I could not confirm whether it is mandatory for every qualifying post. [Moderation notice](https://www.reddit.com/r/ClaudeAI/comments/1wvarsl/removed/).
- Title format: No fixed title prefix or format confirmed.
- Link or text: A bare link with an empty body was removed. Use a text body with the required details if the post qualifies, and add a direct project link. I could not confirm whether a link-type post with a substantial comment is accepted. [Moderation notice](https://www.reddit.com/r/ClaudeAI/comments/1xsffby/removed/).
- Showcase day or thread: No day or designated thread confirmed. The cited rule update describes standalone showcases, subject to its conditions.

### r/ChatGPTCoding

- Self-promotion: Rule 5 directs promotional project content to the weekly self-promotion thread. Standalone posts are rarely allowed, apart from broadly significant AI coding tools. Disclose affiliation and ask moderators if unsure. [Moderator removal notice](https://www.reddit.com/r/ChatGPTCoding/comments/1vikebr/removed/).
- Flair: `Discussion` and `Resources And Tips` are named as the flairs for posts that genuinely fit those categories. The notice does not establish a flair for a promotional thread reply. Do not use those flairs to relabel an ad. [Moderator removal notice](https://www.reddit.com/r/ChatGPTCoding/comments/1vivpnm/removed/).
- Title format: No required title prefix confirmed. A reply in the weekly thread has no post title.
- Link or text: For cc promotion, use a reply in the weekly thread. I could not confirm a required link format or whether standalone link posts are allowed.
- Showcase day or thread: Weekly self-promotion thread. I could not confirm its current weekday or live thread URL. [Moderator removal notice](https://www.reddit.com/r/ChatGPTCoding/comments/1vikebr/removed/).

### r/commandline

- Self-promotion: The community rules prohibit projects or software that interact with generative AI unless discussion concerns popular projects such as the examples in its rule. cc is an agent IDE, so a cc launch post does not appear eligible under that rule. The rules also reject new projects with a short history, low quality posts, spam, and AI-generated post text or titles. Do not submit the cc launch draft there without moderator clarification. [Community rule acknowledgment](https://www.reddit.com/r/commandline/comments/1t8pkj7/please_read_the_rules/).
- Flair: No required flair confirmed. Existing removal notices show category flairs, but do not prove a required choice. [Removal notice](https://www.reddit.com/r/commandline/comments/1t93jdf/removed/).
- Title format: No general prefix confirmed. Rule 4 requires a specific AI-code disclosure when more than a small portion of a project's code is AI-generated. The README does not establish whether that condition applies to cc. [Community rule acknowledgment](https://www.reddit.com/r/commandline/comments/1t8pkj7/please_read_the_rules/).
- Link or text: No required type confirmed. Rule 3 bars URL shorteners and indirect links. The community also requires a rule acknowledgment before posting. [Community rule acknowledgment](https://www.reddit.com/r/commandline/comments/1t8pkj7/please_read_the_rules/).
- Showcase day or thread: None confirmed.

## Show HN

The official [Show HN guidelines](https://news.ycombinator.com/showhn.html) say the title begins with `Show HN` and that the project must be something the author made that others can try. Use the conventional `Show HN:` prefix. A Windows source install is something people can run, but access friction should be explained. Blog posts, sign-up pages, and reading material do not qualify. The maker should be available to discuss the work. The guidelines do not state an 80-character title limit. I could not confirm that limit from an official current page because the submit form requires login; treat 80 as a conservative drafting cap, not a verified rule. [Submit page](https://news.ycombinator.com/submit).

For a first comment, explain why it was built, how it works, what can be tried, and what feedback would help. That is a community norm, not a formal required format. [Community discussion of Show HN comments](https://news.ycombinator.com/item?id=40563762). The [general HN guidelines](https://news.ycombinator.com/newsguidelines.html) say not to post generated or AI-edited text, not to automate posting, and not to solicit votes or comments. A person should write the final submission and comment.

## X

A free account uses the standard 280-character post limit. Longer posts require a subscription. Check each thread post separately. X may count links differently from plain character counting, so the HTML counter is only a draft check. [X Help Center](https://help.x.com/en/using-x/types-of-posts).

## LinkedIn

Posts are limited to 3,000 characters. [LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a522483/differences-between-posting-and-publishing?lang=en). The feed shows only the opening lines before `see more`. I could not confirm a fixed character or line cutoff from LinkedIn; it varies with layout and device. Keep the first sentence self-contained. [LinkedIn Learning guidance](https://www.linkedin.com/learning/marketing-on-linkedin-24856594/copywriting-tips-for-your-personal-posts-on-linkedin).

## Product Hunt

The [Product Hunt launch guide](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page) says the product name is up to 40 characters and should be only the name, so use `cc`. The tagline is up to 60 characters. The description is up to 500 characters. At least one gallery image is required, with a recommended 1270 x 760 px size. The first Maker comment is pinned when the launch goes live and can be up to 5,000 characters. It should explain the maker, problem, product, intended users, and a specific request for feedback. Do not ask for upvotes. The page shell's 500-character Product Hunt block represents the description, not the entire submission. No gallery image is created in this task.

## DEV

The [DEV editor guide](https://dev.to/p/editor_guide) lists Jekyll front matter fields: `title`, `published`, `description`, `tags`, `canonical_url`, `cover_image`, `series`, and `ai_disclosure_level`. Use `published: false` for a draft. Tags are comma-separated and limited to four. The guide recommends a 1000 x 420 cover image, if one is used. No article length limit was confirmed.

## GitHub release notes

GitHub releases use a tag, title, and description. The release editor can generate notes, which should be checked for accuracy. GitHub offers a `This is a pre-release` setting and a saved draft state. For cc, a release draft should state version 0.1.0, Windows only, source installation, and pre-release status. Do not imply a binary installer exists. [GitHub release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository), [generated notes documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).

## Discord and Slack

Discord's standard message cap is 2,000 characters. Nitro raises it to 4,000, so use 2,000 for a message meant to work broadly. [Discord sending messages help](https://support.discord.com/hc/en-us/articles/360034632292-Sending-Messages). Slack recommends keeping a `chat.postMessage` text field within 4,000 characters and truncates it above 40,000. I could not confirm a single universal cap for every Slack client and message format. Community rules and permission to share product links vary by server or workspace. [Slack message API](https://api.slack.com/methods/chat.postMessage).

## Drafting note

The HTML shell's 10,000-character caps are workspace targets where no platform limit was confirmed. They are not platform rules. Every final post must name the honest limits: Windows only, install from source with no installer, and pre-release. If a post names Claude Code, Codex, Gemini, or agy, state that cc is not affiliated with Anthropic, OpenAI, or Google.
