---
name: rubric-check
description: Grade a report, thesis, assignment or application against a marking rubric or brief the user gives or names - criterion by criterion, with the evidence for each score, where marks are being lost, and a submit-ready checklist. Use only when a rubric, marking guide or brief exists, for "is this ready to submit", "what mark would this get", "where am I losing marks", "check it against the rubric". Not for code or design reviews.
---

# rubric-check

Marks come from the rubric, not from how polished the document feels.

## 1. Get the real rubric

Ask for the rubric, brief and template if they are not given. Read them in full. Note the hard
limits (word count and what counts toward it, page limits, required sections, front matter,
file format, deadline). A missing required item is the first finding.

## 2. Score each criterion

For each rubric row:

- Quote the band descriptors.
- Find the evidence in the document (section and page) that meets or misses each band.
- Give the band it sits in now and one sentence on why.
- Name the smallest change that would lift it one band.

## 3. Check facts that markers check

- Every number: rederive it from its source or rerun it. Show the working.
- Every citation: it exists, the quote is in the source, the reference list matches.
- Cross-references, figure numbers and table numbers resolve.
- Word count, measured the way the rubric defines it.

## 4. Report

```text
Predicted: <band or mark range>, from <criteria scores>.
Losing most marks at: <criterion> - <fix>
Hard-limit problems: <list or none>
Submit-ready: yes / no, because <reason>
```

Then a table of all criteria. Order fixes by marks gained per hour of work. Propose fixes in a
copy, never in the file the user will submit, unless they ask. If a second engine is available,
have it score independently and report where the two disagree.
