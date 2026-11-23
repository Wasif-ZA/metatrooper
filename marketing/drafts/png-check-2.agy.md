# Marketing and Header PNG Audit Report

All 14 images opened without errors. Every image uses the new logo. No image shows any trace of the old nested-c logo.

cc is not affiliated with Anthropic, OpenAI or Google.

## Overview of Results

| File | Size | Logo Used | SVG Match | Old Logo Trace | Margins >= 40px | Safe Zones | Text Check |
|---|---|---|---|---|---|---|---|
| `cc-icon-32.png` | 32x32 | `cc-icon.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `cc-icon-64.png` | 64x64 | `cc-icon.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `cc-icon-128.png` | 128x128 | `cc-icon.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `cc-icon-256.png` | 256x256 | `cc-icon.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `cc-icon-512.png` | 512x512 | `cc-icon.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `cc-icon-1024.png` | 1024x1024 | `cc-icon.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `cc-mark-16.png` | 16x16 | `cc-mark.svg` | Pass | None | N/A | N/A | Pass (no text) |
| `og-card.png` | 1200x630 | `cc-icon.svg` | Pass | None | Pass (51px min) | N/A | Pass |
| `github-social-preview.png` | 1280x640 | `cc-icon.svg` | Pass | None | Pass (51px min) | N/A | Pass |
| `x-header.png` | 1500x500 | `cc-icon.svg` | Pass | None | Pass (51px min) | Pass (empty) | Pass |
| `linkedin-banner.png` | 1584x396 | `cc-icon.svg` | Pass | None | Pass (43px min) | Pass (empty) | Pass |
| `hdr-light.png` | 1280x400 | `cc-glyph-ink.svg` | Pass | None | N/A | N/A | Pass |
| `hdr-dark.png` | 1280x400 | `cc-glyph-paper.svg` | Pass | None | N/A | N/A | Pass |
| `fav.png` | 600x120 | `cc-mark.svg` | Pass | None | N/A | N/A | Pass (no text) |

## Detailed File Reports

### 1. `marketing/press-kit/cc-icon-32.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg`. This matches `assets/logos/README.md` for sizes 32px and larger.
- **SVG match**: Shapes and colors match `cc-icon.svg`. The stack shows three cards on an ink `#151516` tile. The front card is wait orange `#ff7a1a` with ink letters and cursor. All four corners are rounded evenly.
- **Old logo traces**: None. No nested curves or round dots appear.
- **Text quality**: No text is present.
- **Card margins**: Not applicable to standalone icons.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 2. `marketing/press-kit/cc-icon-64.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg`. This matches `assets/logos/README.md` for 32px and larger.
- **SVG match**: Matches `cc-icon.svg`. The tile uses ink `#151516`. The front card uses wait orange `#ff7a1a`. All four corners are rounded evenly.
- **Old logo traces**: None.
- **Text quality**: No text is present.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 3. `marketing/press-kit/cc-icon-128.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg`. This matches `assets/logos/README.md`.
- **SVG match**: Matches `cc-icon.svg`. The card strokes use paper `#f1f1ef` at reduced opacity. The front card uses wait orange `#ff7a1a`. All four corners are rounded evenly.
- **Old logo traces**: None.
- **Text quality**: No text is present.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 4. `marketing/press-kit/cc-icon-256.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg`. This matches `assets/logos/README.md`.
- **SVG match**: Matches `cc-icon.svg`. Shapes and colors are correct. All four corners are rounded evenly.
- **Old logo traces**: None.
- **Text quality**: No text is present.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 5. `marketing/press-kit/cc-icon-512.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg`. This matches `assets/logos/README.md`.
- **SVG match**: Matches `cc-icon.svg`. Colors are ink `#151516`, paper `#f1f1ef`, and wait orange `#ff7a1a`. All four corners are rounded evenly.
- **Old logo traces**: None.
- **Text quality**: No text is present.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 6. `marketing/press-kit/cc-icon-1024.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg`. This matches `assets/logos/README.md`.
- **SVG match**: Matches `cc-icon.svg`. The background tile uses ink `#151516` with a corner radius of 224px. All four corners are rounded evenly. The earlier bug where three corners were square is fixed.
- **Old logo traces**: None.
- **Text quality**: No text is present.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 7. `marketing/press-kit/cc-mark-16.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-mark.svg`. This matches `assets/logos/README.md` for 24px and smaller.
- **SVG match**: Matches `cc-mark.svg`. Shows an ink `#151516` tile, paper `#f1f1ef` angular strokes, and an orange `#ff7a1a` cursor underscore. All four corners are transparent and rounded evenly.
- **Old logo traces**: None.
- **Text quality**: No text is present.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.

### 8. `marketing/press-kit/og-card.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg` next to the wordmark `cc`. This matches `assets/logos/README.md` for cards.
- **SVG match**: Matches `cc-icon.svg`. Background is ink `#151516`. Headline is paper `#f1f1ef`. The front card uses wait orange `#ff7a1a`. The lone orange dot from the earlier draft is gone.
- **Old logo traces**: None.
- **Text quality**: All text is sharp. The headline and subhead have high contrast. Footer text has a 7.1:1 contrast ratio against the background. No text clips or overlaps.
- **Card margins**: Content bounds run from x = 75 to 1129, and y = 69 to 578. The minimum margin is 51px at the bottom. No element is within 40px of any edge.
- **Safe zones**: Not applicable to this card format.
- **Text backing**: All copy is backed by `README.md`. Line 4 backs the headline. Lines 5 and 6 back the subhead. Lines 1 and 62 back the footer. Claude Code and Codex are named. The required disclaimer is present: "Not affiliated with Anthropic, OpenAI or Google."

### 9. `marketing/press-kit/github-social-preview.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg` next to the wordmark `cc`. This matches `assets/logos/README.md` for cards.
- **SVG match**: Matches `cc-icon.svg`. Background is ink `#151516`. The lone orange dot in the top right is gone.
- **Old logo traces**: None.
- **Text quality**: Text is sharp and well spaced. No text clips or overlaps.
- **Card margins**: Content bounds run from x = 75 to 1209, and y = 69 to 588. The minimum margin is 51px at the bottom. No element is within 40px of any edge.
- **Safe zones**: Not applicable to this card format.
- **Text backing**: All copy is backed by `README.md` (lines 1, 4, 5, 6, and 62). The required non-affiliation disclaimer is present.

### 10. `marketing/press-kit/x-header.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg` next to the wordmark `cc`. This matches `assets/logos/README.md` for cards.
- **SVG match**: Matches `cc-icon.svg`. Background is ink `#151516`. The lone orange dot in the top right is gone.
- **Old logo traces**: None.
- **Text quality**: Text is sharp and legible. The headline fits on one line without clipping. The footer font size is 18px and reads clearly.
- **Card margins**: Content bounds run from x = 449 to 1429, and y = 51 to 448. The minimum margin is 51px. No element is within 40px of any edge.
- **Safe zones**: The bottom-left 400x200 profile photo area contains zero non-background pixels. Content begins at x = 449px.
- **Text backing**: All copy is backed by `README.md` (lines 1, 4, 5, 6, and 62). The required non-affiliation disclaimer is present.

### 11. `marketing/press-kit/linkedin-banner.png`

- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-icon.svg` next to the wordmark `cc`. This matches `assets/logos/README.md` for cards.
- **SVG match**: Matches `cc-icon.svg`. Background is ink `#151516`. The lone orange dot in the top right is gone.
- **Old logo traces**: None.
- **Text quality**: Text is sharp and legible. The headline fits on one line without clipping. The footer font size is 18px and reads clearly.
- **Card margins**: Content bounds run from x = 449 to 1513, and y = 51 to 352. The minimum margin is 43px at the bottom. No element is within 40px of any edge.
- **Safe zones**: The left 400px profile photo area contains zero non-background pixels. Content begins at x = 449px.
- **Text backing**: All copy is backed by `README.md` (lines 1, 4, 5, 6, and 62). The required non-affiliation disclaimer is present.

### 12. `hdr-light.png`

- **Path**: `C:/Users/wasif/AppData/Local/Temp/claude/96b6c0d9ec1c018b/6e309897-0b61-4d80-a337-639ed42cf964/scratchpad/hdr-light.png`
- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-glyph-ink.svg` next to the wordmark `cc`. This matches `assets/logos/README.md` for light headers. No tile wraps the glyph.
- **SVG match**: Matches `cc-glyph-ink.svg`. Strokes use ink `#151516`. The rectangular cursor uses wait orange on light `#c45200`. Background is light `#f6f6f4`.
- **Old logo traces**: None.
- **Text quality**: All text is crisp and legible. High contrast on both header links and hero copy.
- **Card margins**: Not a card. The content container follows standard 16px lateral padding with a centered 1080px inner width.
- **Safe zones**: Not applicable.
- **Text backing**: All copy is backed by `README.md` (lines 4, 5, 6, 17, 52, 72, and 84).
  The screenshot is cropped above the fold. The mandatory vendor non-affiliation disclaimer lives in the footer of `site-light.html` rather than inside the hero crop.

### 13. `hdr-dark.png`

- **Path**: `C:/Users/wasif/AppData/Local/Temp/claude/96b6c0d9ec1c018b/6e309897-0b61-4d80-a337-639ed42cf964/scratchpad/hdr-dark.png`
- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-glyph-paper.svg` next to the wordmark `cc`. This matches `assets/logos/README.md` for dark headers. No tile wraps the glyph.
- **SVG match**: Matches `cc-glyph-paper.svg`. Strokes use paper `#f1f1ef`. The rectangular cursor uses wait orange on dark `#ff7a1a`. Background is dark `#111112`.
- **Old logo traces**: None.
- **Text quality**: All text is crisp and legible. High contrast throughout.
- **Card margins**: Not a card. Follows standard site layout.
- **Safe zones**: Not applicable.
- **Text backing**: All copy is backed by `README.md`.
  The screenshot is cropped above the fold. The mandatory vendor disclaimer lives in the footer of `site-dark.html`.

### 14. `fav.png`

- **Path**: `C:/Users/wasif/AppData/Local/Temp/claude/96b6c0d9ec1c018b/6e309897-0b61-4d80-a337-639ed42cf964/scratchpad/fav.png`
- **Status**: The file opened successfully.
- **Logo file**: Uses `cc-mark.svg` at 16px and 64px. This matches `assets/logos/README.md` for favicon use.
- **SVG match**: Matches `cc-mark.svg`. Shows an ink `#151516` tile, paper `#f1f1ef` angular strokes, and an orange `#ff7a1a` cursor underscore. Both icons are rendered on a neutral grey `#888888` background.
- **Old logo traces**: None.
- **Text quality**: No text is present. The glyph is clearly recognizable at 16px and sharp at 64px.
- **Card margins**: Not applicable.
- **Safe zones**: Not applicable.
- **Text backing**: No text is present.
