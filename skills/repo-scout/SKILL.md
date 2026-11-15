---
name: repo-scout
description: Find open-source projects similar to the user's product or idea, verify each with the GitHub CLI (stars, licence, last push), and report features, gaps and mechanisms worth rebuilding, each tied to real source at a real commit. Use for "find similar projects", "research repos for X", "what features are we missing", "can we lift code from these", or "is this repo worth using".
---

# repo-scout

Ideas from real source, not from memory. Every claim names a repo, a commit and a file.

## 1. Map the target first

List the product's main modules (file, one line each) and its known pain: open issues, user
complaints, gaps the user named. Scout for those jobs, not for the product's category name.

## 2. Find candidates

- `gh api -X GET search/repositories -f q='<words> stars:>500' -f sort=stars -f per_page=50 --jq '.items[]|[.full_name,.stargazers_count,.license.spdx_id,.pushed_at]|@tsv'`
- Search several phrasings per job, and look beyond direct rivals (a terminal app may hold the
  best tab model for an IDE).
- For user pain and demand, prefer practitioner sources (forums, issue trackers, discussion
  threads) over vendor pages.
- Triage widely (30+), read deeply only the best 5 to 10.

## 3. Read real source

- Pin a commit: `gh api repos/<o>/<r>/commits/HEAD --jq .sha`.
- Read files at that commit: `gh api "repos/<o>/<r>/contents/<path>?ref=<sha>" --jq .content`
  and base64-decode it.
- Before proposing anything, grep the target repo for the same mechanism and say what exists.

## 4. Report

One table per job:

| Repo | Stars | Licence | Last push | Mechanism (file@sha) | Target file it would change | Exists today? |

Then the top 5 picks with one line each on why. Licence decides reuse: permissive licences can
be adapted with notice; copyleft or no licence means ideas only. For a new dependency, report
stars, licence and maintenance so the user can apply their own bar. Nothing goes into the repo
until the user picks.
