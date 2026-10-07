// Fixture for one study-notes-to-pdf run of pipelines/study-notes-to-pdf.json. Steps confirmed by Wasif 2026-10-07. Waiting at the signoff gate.
window.RUN = {
  pipeline: { id: 'study-notes-to-pdf', title: 'Study notes to PDF', lane: 'Study and documents', budget_min: 20, requires: ['docs-export'], inferred: true },
  project: { name: 'study-notes', path: '~/study-notes', about: 'a folder of lecture PDFs and the notes made from them' },
  inputs: [['Lecture', 'lectures/week06-how-caches-work.pdf'], ['Paper', 'A4'], ['Notes', 'summary, terms, one worked example, self-test questions'], ['Output', 'out/week06-cache-notes.pdf']],
  run: { id: 'run-5e1a', started: '19:02', elapsed: '4m 52s', tokens: '38,400', cost: '$0.31', dir: '~/study-notes/.troop/runs/run-5e1a' },
  steps: [
    { id: 'ingest', title: 'Read the lecture PDF', kind: 'action', role: 'ingest', uses: 'plugin:docs-export/ingest', status: 'done', took: '0m 06s', out: '18 slides, text and a page image each' },
    { id: 'outline', title: 'Outline the lecture', kind: 'agent', role: 'plan', status: 'done', took: '0m 41s', tokens: '6,200', out: 'outline.md: 6 sections, 12 terms' },
    { id: 'notes', title: 'Write the notes', kind: 'agent', role: 'worker', status: 'done', took: '1m 38s', tokens: '14,900', out: 'notes.md: 34 lines, every line cites a slide' },
    { id: 'check', title: 'Check every line against its slide', kind: 'agent', role: 'verify', status: 'done', took: '0m 54s', tokens: '9,800', out: '34/34 sourced (1 rewritten), 15 slides cited, 3 skipped with a reason' },
    { id: 'export', title: 'Export the PDF', kind: 'action', role: 'worker', uses: 'plugin:docs-export/export-pdf', status: 'done', took: '0m 03s', out: 'out/week06-cache-notes.pdf, 6 pages, A4, 212 KB' },
    { id: 'proof', title: 'Proof every page', kind: 'agent', role: 'visual-check', status: 'done', took: '1m 02s', tokens: '7,500', out: '2 rounds, 6/6 pages clean', loop: { steps: ['export', 'proof'], until: 'steps.proof.passed', max: 2, rounds: 2 } },
    { id: 'signoff', title: 'Read the PDF, then Continue', kind: 'gate', gate: 'handoff', status: 'waiting', waiting: '1m 12s' },
  ],
  // the lecture, from plugin:docs-export/ingest. Invented course and content; generic textbook material.
  lecture: {
    file: 'lectures/week06-how-caches-work.pdf', course: 'Computer systems basics (invented course)', title: 'Lecture 6: How caches work', pages: 18,
    slides: [
      { p: 1, title: 'Lecture 6: How caches work', lines: ['Computer systems basics', 'Week 6'] },
      { p: 2, title: 'Today', lines: ['Why caches exist', 'Lines, hits and misses', 'Where a block can go', 'Replacing and writing', 'A worked example'] },
      { p: 3, title: 'The speed gap', lines: ['The CPU is far faster than main memory', 'One load from DRAM takes about 100 cycles'] },
      { p: 4, title: 'The memory hierarchy', lines: ['Registers, L1, L2, L3, DRAM, disk', 'Higher: faster and smaller', 'Lower: slower and larger'] },
      { p: 5, title: 'Locality', lines: ['Temporal: data used now is used again soon', 'Spatial: data near it is used soon', 'Why a small cache catches most accesses'] },
      { p: 6, title: 'Cache lines', lines: ['Data moves in fixed blocks', 'Usually 64 bytes'] },
      { p: 7, title: 'Hits and misses', lines: ['Hit: the data is in the cache', 'Miss: fetch it from the level below', 'Hit rate = hits / accesses', 'Miss penalty: the extra time a miss costs'] },
      { p: 8, title: 'Average memory access time', lines: ['AMAT = hit time + miss rate x miss penalty'] },
      { p: 9, title: 'SRAM and DRAM', lines: ['SRAM: fast, costs more per bit, used for caches', 'DRAM: slower, cheaper per bit, denser, used for main memory'] },
      { p: 10, title: 'Direct-mapped', lines: ['Each block has exactly one place', 'Set = block number mod number of sets'] },
      { p: 11, title: 'Fully associative', lines: ['A block can go anywhere', 'Every tag must be searched'] },
      { p: 12, title: 'Set associative', lines: ['A block goes in one set, in any of n ways', '8-way is common for L1'] },
      { p: 13, title: 'Mapping compared', table: [['Mapping', 'Places per block', 'Tags searched', 'Conflict misses'], ['Direct-mapped', '1', '1', 'most'], ['n-way set', 'n', 'n', 'fewer'], ['Fully associative', 'all', 'all', 'none']] },
      { p: 14, title: 'Splitting an address', lines: ['tag | index | offset', 'Offset: the byte in the line', 'Index: the set', 'Tag: which block is there'] },
      { p: 15, title: 'Replacement', lines: ['LRU evicts the least recently used line', 'Random is cheaper to build and close to LRU'] },
      { p: 16, title: 'Writes', lines: ['Write-through: every store goes below at once', 'Write-back: write only when a dirty line is evicted', 'Dirty bit: set when the line has changed'] },
      { p: 17, title: 'Worked example', lines: ['Hit 1 cycle, miss rate 5%, penalty 100 cycles', 'AMAT = 1 + 0.05 x 100 = 6 cycles', 'Halve the miss rate: 1 + 0.025 x 100 = 3.5 cycles'] },
      { p: 18, title: 'Summary', lines: ['Locality makes small caches work', 'Mapping decides where a block goes', 'Write policy decides when memory is updated'] },
    ],
  },
  // outline.md
  outline: {
    sections: [
      { n: 1, title: 'Why caches exist', slides: [3, 4, 5] },
      { n: 2, title: 'Lines, hits and misses', slides: [6, 7, 8, 9] },
      { n: 3, title: 'Where a block can go', slides: [10, 11, 12, 13, 14] },
      { n: 4, title: 'Replacing and writing', slides: [15, 16] },
      { n: 5, title: 'Worked example', slides: [17] },
      { n: 6, title: 'Self-test', slides: [5, 6, 8, 14, 16] },
    ],
    terms: ['locality', 'cache line', 'hit rate', 'miss penalty', 'AMAT', 'SRAM', 'DRAM', 'direct-mapped', 'set associative', 'tag', 'LRU', 'dirty bit'],
  },
  // notes.md: every line cites the slide(s) it came from
  notes: {
    title: 'How caches work: study notes', file: 'notes.md', lines_total: 34,
    sections: [
      { n: 1, title: 'Why caches exist', lines: [
        { n: 1, text: 'The CPU is far faster than main memory; one DRAM load takes about 100 cycles.', p: [3] },
        { n: 2, text: 'Memory is a hierarchy: registers, L1, L2, L3, DRAM, disk.', p: [4] },
        { n: 3, text: 'Higher levels are faster and smaller; lower levels are slower and larger.', p: [4] },
        { n: 4, text: 'Temporal locality: data used now is used again soon.', p: [5] },
        { n: 5, text: 'Spatial locality: data next to it is used soon.', p: [5] },
        { n: 6, text: 'Term: locality, why a small cache catches most accesses.', p: [5], kind: 'term' },
      ] },
      { n: 2, title: 'Lines, hits and misses', lines: [
        { n: 7, text: 'Data moves between levels in fixed blocks called cache lines, usually 64 bytes.', p: [6] },
        { n: 8, text: 'A hit means the data is already in the cache; a miss means fetching it from below.', p: [7] },
        { n: 9, text: 'Hit rate is hits divided by all accesses.', p: [7] },
        { n: 10, text: 'Miss penalty is the extra time a miss costs.', p: [7] },
        { n: 11, text: 'AMAT = hit time + miss rate x miss penalty.', p: [8] },
        { n: 12, text: 'Caches use SRAM: fast, but it costs more per bit.', p: [9], rewritten: { from: 'SRAM is about 10x cheaper per bit than DRAM.', why: 'no slide says this; slide 9 says the opposite' } },
        { n: 13, text: 'Main memory uses DRAM: slower, cheaper per bit and denser.', p: [9] },
      ] },
      { n: 3, title: 'Where a block can go', lines: [
        { n: 14, text: 'Direct-mapped: each block has exactly one possible place.', p: [10] },
        { n: 15, text: 'Its set is the block number mod the number of sets.', p: [10] },
        { n: 16, text: 'Fully associative: a block can go anywhere, so every tag is searched.', p: [11] },
        { n: 17, text: 'Set associative: a block goes in one set, in any of its n ways.', p: [12] },
        { n: 18, text: '8-way set associative is common for L1.', p: [12] },
        { n: 19, text: 'Table: mapping compared (places per block, tags searched, conflict misses).', p: [13], kind: 'table' },
        { n: 20, text: 'An address splits into tag, index and offset.', p: [14] },
        { n: 21, text: 'Offset picks the byte, index picks the set, tag says which block is there.', p: [14] },
      ] },
      { n: 4, title: 'Replacing and writing', lines: [
        { n: 22, text: 'When a set is full, LRU evicts the least recently used line.', p: [15] },
        { n: 23, text: 'Random replacement is cheaper to build and close to LRU.', p: [15] },
        { n: 24, text: 'Write-through sends every store to the level below at once.', p: [16] },
        { n: 25, text: 'Write-back writes only when a dirty line is evicted.', p: [16] },
        { n: 26, text: 'Term: dirty bit, set when a line has changed since it was loaded.', p: [16], kind: 'term' },
      ] },
      { n: 5, title: 'Worked example', lines: [
        { n: 27, text: 'Hit time 1 cycle, miss rate 5%, miss penalty 100 cycles.', p: [17], kind: 'example' },
        { n: 28, text: 'AMAT = 1 + 0.05 x 100.', p: [17], kind: 'example' },
        { n: 29, text: '= 1 + 5 = 6 cycles.', p: [17], kind: 'example' },
        { n: 30, text: 'Halve the miss rate to 2.5%: 1 + 0.025 x 100 = 3.5 cycles.', p: [17], kind: 'example' },
      ] },
      { n: 6, title: 'Self-test', lines: [
        { n: 31, text: 'Why does a 64-byte line help a loop over an array?', p: [5, 6], kind: 'question', answer: 'spatial locality: one miss brings in the next elements' },
        { n: 32, text: 'What does the index field of an address choose?', p: [14], kind: 'question', answer: 'the set' },
        { n: 33, text: 'When does a write-back cache write to memory?', p: [16], kind: 'question', answer: 'when a dirty line is evicted' },
        { n: 34, text: 'AMAT for a 2 cycle hit, 10% miss rate, 50 cycle penalty?', p: [8], kind: 'question', answer: '2 + 0.10 x 50 = 2 + 5 = 7 cycles' },
      ] },
    ],
  },
  // check step: line against slide, and slide coverage
  check: {
    lines: { total: 34, sourced: 34, rewritten: 1, cut: 0 },
    slides: { total: 18, cited: 15, skipped: [[1, 'title slide'], [2, 'contents slide'], [18, 'summary repeats slides 4 to 16']] },
    failures: [{ line: 12, was: 'SRAM is about 10x cheaper per bit than DRAM.', problem: 'no slide says this; slide 9 says SRAM costs more per bit', fix: 'rewritten from slide 9', now: 'Caches use SRAM: fast, but it costs more per bit.', p: 9, rerun: 'ok' }],
    passed: true,
  },
  // the PDF: which sections land on which page, per proof round
  pdf: {
    file: 'out/week06-cache-notes.pdf', paper: 'A4', size: '212 KB', pages_total: 6,
    pages: [
      { page: 1, holds: ['title', 'section 1', 'section 2 lines 7 to 9'] },
      { page: 2, holds: ['section 2 lines 10 to 13', 'section 3 lines 14 to 18'] },
      { page: 3, holds: ['section 3 lines 20 to 21'] },
      { page: 4, holds: ['mapping compared table', 'section 4'] },
      { page: 5, holds: ['section 5 worked example'] },
      { page: 6, holds: ['section 6 self-test', 'answers'] },
    ],
  },
  proof: {
    rounds: [
      { round: 1, passed: false, pages: 6, issues: [{ page: 3, issue: 'table "Mapping compared" splits across pages 3 and 4', fix: 'print.css: table { break-inside: avoid; }' }] },
      { round: 2, passed: true, pages: 6, issues: [] },
    ],
  },
  gate: {
    step: 'signoff',
    gate: 'handoff',
    summary: 'Read out/week06-cache-notes.pdf. Every line cites its slide. Continue keeps the PDF; Reject cancels the run.',
    keys: [['C', 'Continue'], ['R', 'Reject'], ['Enter', 'Open line source']],
  },
  // ?state=unsourced: alternate run where the fix pass could not source a line; flagged, the run continues to signoff
  unsourced: { line: 12, text: 'SRAM is about 10x cheaper per bit than DRAM.', problem: 'no slide says this; the rewrite still had no slide behind it', choices: [['cut', 'Cut the line'], ['keep', 'Keep it, marked unsourced']] },
  // ?state=gaveup: alternate run where proof round 2 still finds the split table
  gaveup: { round: 2, page: 3, issue: 'table "Mapping compared" still splits across pages 3 and 4' },
  stream: {
    ingest: ['pdf.js: 18 pages', 'text per slide, page image per slide', 'wrote slides.json'],
    outline: ['read 18 slides', 'skip slide 1 (title), slide 2 (contents)', '6 sections, 12 terms', 'wrote outline.md'],
    notes: ['section 1: 6 lines', 'section 2: 7 lines', 'section 3: 8 lines with the mapping table', 'section 4: 5 lines', 'worked example from slide 17', '4 self-test questions with answers', 'wrote notes.md, 34 lines'],
    check: ['match 34 lines to their slides', 'lines 1 to 11 ok', 'line 12: no slide says SRAM is cheaper', 'rewrite line 12 from slide 9', 'recheck line 12 ok', 'lines 13 to 34 ok', 'slides: 15 cited, 3 skipped with a reason'],
    export: ['printToPDF notes.md + print.css, A4', 'out/week06-cache-notes.pdf, 6 pages'],
    proof: ['round 1: read 6 page images', 'page 3: table splits across pages 3 and 4', 'print.css: table { break-inside: avoid; }', 'round 2: export again, 6 pages', 'round 2: 6/6 pages clean, passed'],
  },
  // hand-back tray after Continue. The PDF is untracked in out/; the user opens it, the app runs nothing.
  handback: {
    untracked: [['out/week06-cache-notes.pdf', '212 KB'], ['notes.md', '34 lines']],
    diff: { files: [], added: 0, removed: 0 },
    items: [
      { n: 1, text: 'Open the notes PDF', command: 'start "" "out\\week06-cache-notes.pdf"' },
    ],
  },
};
