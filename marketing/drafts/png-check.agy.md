# Visual and Technical Quality Check: Marketing Assets and Screenshots

This document reports the visual inspection of all 12 marketing images, mark exports, and site screenshots.

All 12 images were successfully opened, inspected at native resolution, and audited against `README.md` and `assets/logos/README.md`. No image failed to open.

---

## Executive Summary of Key Findings

1. **Mark Export Tile Geometry Bug (`cc-mark-*.png`)**:
   In `marketing/press-kit/src/mark-exports.html`, line 2 defines `<rect width="1024" height="1024" rx="14" fill="#151516"/>` inside a `viewBox="0 0 64 64"`. Because the rect is sixteen times larger than the viewbox, only the top-left corner (0,0) is rounded. The top-right, bottom-left, and bottom-right corners are sharp 90-degree square edges. This defect affects `cc-mark-1024.png`, `cc-mark-64.png`, `cc-mark-32.png`, and `cc-mark-16.png`.
2. **Lone Orange Dot Top-Right (Banners)**:
   All four banner cards contain a lone 13px orange dot (`#ff7a1a`) floating at `right: 80px, top: 72px`. In `assets/logos/README.md`, the orange dot belongs inside the nested C mark. Placed by itself in the corner, it looks like a dead pixel or rendering error. **Recommendation: Cut.**
3. **Social Media Profile Photo Safe Zones**:
   - **X Header (1500x500)**: The bottom-left 400x200 profile photo area is completely empty. The design sets `padding-left: 450px` across the entire banner, leaving the entire left 450px blank.
   - **LinkedIn Banner (1584x396)**: The left 400px profile zone is completely empty. All content begins at x = 450px.
4. **Mobile Screenshots (360px Viewport)**:
   - In the hero install command, the text overflows horizontally and is clipped at `git clone https://github.com/W` by the Copy button.
   - In Get started, the preformatted code block clips commands horizontally on the right.
   - The screenshot iframe was hardcoded to 5600px height, which cut off the bottom of the page (Questions, First release, and Footer).

---

## Image-by-Image Inspection Reports

### 1. `marketing/press-kit/og-card.png` (1200x630)

- **What is on it**:
  - Ink background (`#151516`).
  - Top-left brand mark (`cc-mark.svg` inline, 76x76) and wordmark `cc` in Cascadia Mono font (64px, weight 700).
  - Headline: `An IDE built around your coding agents.` (54px, weight 600, color `#f1f1ef`).
  - Supporting line: `Claude Code, Codex and other CLI agents side by side. One place tells you who needs you.` (25px, color `#bdbdbb`).
  - Dark horizontal divider line (`#39393b`).
  - Footer: `Windows first. Local only. No account, no telemetry.` and `Not affiliated with Anthropic, OpenAI or Google.` (16px, color `#99999c`).
  - Lone orange circle (`#ff7a1a`, diameter 13px) in the top-right corner.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No text is clipped or overlapping.
  - High contrast for headline (16.5:1) and subhead (10.4:1).
  - Footer text contrast is 7.1:1, meeting accessibility standards.
- **Anything inside 40px of the edge**:
  - No. Content padding is `62px 70px 48px 76px`. All elements sit at least 48px from every outer boundary.
- **X header and LinkedIn safe zones**:
  - Not applicable to this aspect ratio.
- **Logo match to `assets/logos/README.md`**:
  - The nested C curves and the orange dot match `cc-mark-paper.svg`.
  - The dot uses wait orange `#ff7a1a` on a dark background. The dot is not recoloured.
- **Text backed by `README.md`**:
  - Headline backed by line 4.
  - Subhead backed by lines 5–6.
  - Footer backed by lines 1 and 62.
- **Oddities and lone orange dot**:
  - The top-right orange dot floats without context. **Verdict: Cut.**

---

### 2. `marketing/press-kit/github-social-preview.png` (1280x640)

- **What is on it**:
  - Ink background (`#151516`).
  - Identical content and typography to `og-card.png`, rendered at 1280x640.
  - Brand mark and `cc` wordmark top-left.
  - Headline: `An IDE built around your coding agents.`
  - Supporting line: `Claude Code, Codex and other CLI agents side by side. One place tells you who needs you.`
  - Footer: `Windows first. Local only. No account, no telemetry.` and `Not affiliated with Anthropic, OpenAI or Google.`
  - Lone orange dot top-right.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No clipped, overlapping, or blurry text.
  - Contrast ratios match `og-card.png`.
- **Anything inside 40px of the edge**:
  - No. Outer margins are all greater than 48px.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - Matches the specifications in `assets/logos/README.md`.
  - Dot color is `#ff7a1a`. The dot is not recoloured.
- **Text backed by `README.md`**:
  - Fully backed by `README.md` lines 1, 4, 5–6, and 62.
- **Oddities and lone orange dot**:
  - The lone orange dot sits at `right: 80px, top: 72px`. **Verdict: Cut.**
  - The preview uses the same general card layout without repository specific information (such as test counts or install from source).

---

### 3. `marketing/press-kit/x-header.png` (1500x500)

- **What is on it**:
  - Ink background (`#151516`).
  - Left 450px is empty black space.
  - At x = 450px: Brand mark (58x58) and wordmark `cc` (52px font).
  - Headline: `An IDE built around your coding agents.` (47px font).
  - Supporting line: `Claude Code, Codex and other CLI agents side by side. One place tells you who needs you.` (19px font).
  - Thin rule (`#39393b`) and small footer text (12px font, `#99999c`).
  - Lone orange dot at `right: 80px, top: 72px`.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No clipped or overlapping text.
  - The footer text is set to `12px` font size on a 1500px wide image. On mobile devices or standard desktop displays, this text shrinks below 4px and becomes unreadable.
- **Anything inside 40px of the edge**:
  - No. Margins: top 46px, bottom 48px, left 450px, right 60px–80px.
- **X header bottom-left 400x200 profile-photo zone**:
  - **Pass. The zone is completely empty.**
  - All content is pushed to x = 450px by `padding-left: 450px`.
- **Logo match to `assets/logos/README.md`**:
  - Mark strokes and `#ff7a1a` orange dot match `assets/logos/README.md`.
- **Text backed by `README.md`**:
  - Backed by lines 1, 4, 5–6, and 62.
- **Oddities and lone orange dot**:
  - **Lone orange dot**: Present top right. **Verdict: Cut.**
  - **Top-left dead space**: Because the 450px offset was applied to the entire frame rather than only the bottom-left area, the top-left area is also empty.
  - **Footer font size**: 12px text is too small for a banner of this dimension.

---

### 4. `marketing/press-kit/linkedin-banner.png` (1584x396)

- **What is on it**:
  - Ink background (`#151516`).
  - Left 450px is empty black space.
  - Content block starting at x = 450px: brand mark, `cc` wordmark, headline, subhead, divider rule, and footer.
  - Lone orange dot at `right: 80px, top: 72px`.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No clipping or text overlaps.
  - Footer font size is 12px on a 1584px canvas, causing poor legibility at scale.
  - Vertical layout is compressed due to the 396px height constraint.
- **Anything inside 40px of the edge**:
  - No. Margins: top 46px, bottom 48px, left 450px, right 60px–80px.
- **LinkedIn left 400px photo zone**:
  - **Pass. The zone is completely empty.**
  - The left 450px contains no text or graphic elements.
- **Logo match to `assets/logos/README.md`**:
  - Matches the logo specifications. Dot is `#ff7a1a`.
- **Text backed by `README.md`**:
  - Backed by lines 1, 4, 5–6, and 62.
- **Oddities and lone orange dot**:
  - **Lone orange dot**: Present top right. **Verdict: Cut.**
  - **Reused CSS**: Uses identical CSS classes and offsets from `x-header.html`, resulting in the same 12px footer and wide left void.

---

### 5. `marketing/press-kit/cc-mark-16.png` (16x16)

- **What is on it**:
  - 16x16 pixel icon of the cc mark on a dark tile.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No text. Glyphs are softened by sub-pixel anti-aliasing due to small dimensions.
- **Anything inside 40px of the edge**:
  - The entire image is 16x16 pixels.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - **Fails on tile geometry.**
  - Top-left corner pixel is transparent (`A=0`).
  - Bottom-right corner pixel is opaque (`A=255`, RGB: 25, 25, 26).
  - The tile is asymmetric because of the `width="1024"` bug in `mark-exports.html`.
  - The inner nested C glyph and the orange dot match the design.
- **Text backed by `README.md`**:
  - Not applicable (icon only).
- **Oddities**:
  - Asymmetric corner rounding caused by export template bug.

---

### 6. `marketing/press-kit/cc-mark-32.png` (32x32)

- **What is on it**:
  - 32x32 pixel icon of the cc mark on a dark tile.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No text. Icon curves are readable.
- **Anything inside 40px of the edge**:
  - Entire image is 32x32 pixels.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - **Fails on tile geometry.**
  - Top-left corner is rounded and transparent (`A=0`).
  - Bottom-right corner is square and fully opaque (`A=255`).
  - Top-right and bottom-left edges are straight cuts rather than squircle curves.
  - The wait orange dot and nested C shapes are accurate.
- **Text backed by `README.md`**:
  - Not applicable.
- **Oddities**:
  - Defective tile geometry inherited from the master export.

---

### 7. `marketing/press-kit/cc-mark-64.png` (64x64)

- **What is on it**:
  - 64x64 pixel icon of the cc mark on an ink tile.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - Sharp rendering at 1:1 viewbox scale.
- **Anything inside 40px of the edge**:
  - Entire image is 64x64 pixels.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - **Fails on tile geometry.**
  - Only the top-left corner exhibits the 14px corner radius.
  - The other three corners are sharp 90-degree square angles.
  - The glyph and wait orange dot (`#ff7a1a`) are correctly positioned.
- **Text backed by `README.md`**:
  - Not applicable.
- **Oddities**:
  - The tile does not match `assets/logos/cc-mark.svg` where all four corners have `rx="14"`.

---

### 8. `marketing/press-kit/cc-mark-1024.png` (1024x1024)

- **What is on it**:
  - High resolution 1024x1024 export of the cc mark.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - High fidelity vector rasterization.
- **Anything inside 40px of the edge**:
  - The graphic fills the 1024x1024 canvas to the borders.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - **Major Defect in Tile Shape**:
    - Corner pixel alpha inspection:
      - Top-Left: `A = 0` (transparent corner).
      - Top-Right: `A = 255` (fully opaque sharp corner).
      - Bottom-Left: `A = 255` (fully opaque sharp corner).
      - Bottom-Right: `A = 255` (fully opaque sharp corner).
    - In `mark-exports.html`, line 2 contains `<rect width="1024" height="1024" rx="14" fill="#151516"/>` inside `<svg viewBox="0 0 64 64">`.
    - Because the rectangle width and height were set to 1024 inside a 64x64 coordinate system, the rect extends far outside the viewport. Only the top-left corner falls within view. The other three corners are rendered as straight unrounded edges.
    - Fix required: change `<rect width="1024" height="1024" rx="14"...>` to `<rect width="64" height="64" rx="14"...>` in `mark-exports.html`.
- **Text backed by `README.md`**:
  - Not applicable.
- **Oddities**:
  - Only top-left corner is rounded.

---

### 9. `site-1280-dark.png` (1280x800)

- **What is on it**:
  - Desktop browser rendering of `site-dark.html` (rebranded draft).
  - Header: `cc` logo mark + wordmark, nav links (`Four parts`, `Get started`, `Limits`, `GitHub`, `Light / dark` button).
  - Hero:
    - Headline: `Your agents.` (white `#f1f1ef`), `One wall.` (muted `#a4a4a8`).
    - Paragraph citing Claude Code, Codex, and other CLI agents.
    - Facts: `Windows first`, `Local only`, `No account, no telemetry`.
    - Clone snippet with Copy button.
    - `Get started` button and `Source on GitHub` button.
  - Section "Four parts" heading and subhead.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - Clean and sharp typography.
  - No clipping or overlapping.
  - High contrast throughout.
- **Anything inside 40px of the edge**:
  - No. Content is centered in a 1080px container with 100px margins on left and right.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - Uses `cc-mark-paper.svg` markup (paper strokes on dark background with `#ff7a1a` orange dot). Matches specifications.
- **Text backed by `README.md`**:
  - Backed by lines 1, 4–6, 31, 61–62, and 84.
  - Note: Vendor engine names (Claude Code, Codex) appear in the hero paragraph. The mandatory disclaimer is placed in the footer below the fold.
- **Oddities**:
  - None.

---

### 10. `site-1280-light.png` (1280x800)

- **What is on it**:
  - Light mode version of the 1280px desktop view.
  - Light background (`#f6f6f4`), ink text (`#151516`).
  - Layout and text match the dark version.
  - Header logo uses the ink tile version (`cc-mark.svg`).
- **Clipped, overlapping, blurry, or low-contrast text**:
  - No clipping or overlapping text.
  - High contrast ratios.
- **Anything inside 40px of the edge**:
  - No. Content has 100px left and right gutters.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - Matches `cc-mark.svg` with dark tile and `#ff7a1a` orange dot.
  - Note: `assets/logos/README.md` also provides `cc-mark-ink.svg` for light backgrounds without a tile. Using the tiled mark is acceptable but differs from dark mode where an untiled mark was used.
- **Text backed by `README.md`**:
  - All text is backed by `README.md`.
- **Oddities**:
  - None.

---

### 11. `site-360-light.png` (600x5600; 360px viewport)

- **What is on it**:
  - Mobile viewport (360px wide) of `site-light.html` rendered on the left of a 600px frame with grey background on the right.
  - Shows Header, Hero, Four parts, The wall, Browser use, Computer use, Core services, Works with, Get started, and partial Limits section.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - **Horizontal clipping in hero install box**: The clone command is cut off by the Copy button (`git clone https://github.com/W...`).
  - **Horizontal clipping in Get started code block**: Preformatted command lines exceed 360px width and are clipped at the right margin (`...# optic`, `cd workbench && npm run dev # opens the`).
  - **Vertical screenshot truncation at 5600px**: The bottom part of the page (Questions FAQ, First release section, and Footer) was cut off because the iframe height was fixed to 5600px in `frame-light.html`.
  - Contrast is good throughout. Native text does not overlap.
- **Anything inside 40px of the edge**:
  - Yes. On a 360px mobile screen, padding is set to `16px`. All content is located within 16px of the left and right mobile screen boundaries. This is standard mobile behavior.
- **X header and LinkedIn safe zones**:
  - Not applicable.
- **Logo match to `assets/logos/README.md`**:
  - Uses `cc-mark.svg` ink tile in the header. Orange dot is intact.
- **Text backed by `README.md`**:
  - Content reflects updated copy:
    - Unsupported claims (Linux beta, macOS, demo data, opencode) have been removed.
    - Vendor disclaimer is included under the "Works with" engine chips.
    - Quickstart correctly references starting the core service.
- **Oddities**:
  - In the "Works with" section, the chip says `agy` instead of `Antigravity CLI (agy)`.
  - The hero install box truncates long text without an obvious indicator.

---

### 12. `site-360-dark.png` (600x5600; 360px viewport)

- **What is on it**:
  - Dark mode mobile view (360px wide) of `site-dark.html`.
  - Content matches `site-360-light.png` on dark background `#111112`.
- **Clipped, overlapping, blurry, or low-contrast text**:
  - Same horizontal clipping in the hero clone box (`git clone https://github.com/W...`).
  - Same horizontal clipping in the Get started preformatted code block.
  - Same vertical truncation at 5600px height cutting off FAQ, release banner, and footer.
- **Anything inside 40px of the edge**:
  - Yes. 16px lateral padding on mobile viewport.
- **Logo match to `assets/logos/README.md`**:
  - Matches `cc-mark-paper.svg`.
- **Text backed by `README.md`**:
  - Fully backed.
- **Oddities**:
  - Same clipping and screenshot frame truncation issues as `site-360-light.png`.

---

## Summary Checklist

| Asset | Size | Status | Inside 40px Margin | Profile Safe Zone | Logo Spec Match | Backed by `README.md` | Oddities / Flaws |
|---|---|---|---|---|---|---|---|
| `og-card.png` | 1200x630 | Opened | No | N/A | Pass | Pass | Lone orange dot top-right (cut) |
| `github-social-preview.png` | 1280x640 | Opened | No | N/A | Pass | Pass | Lone orange dot top-right (cut) |
| `x-header.png` | 1500x500 | Opened | No | Pass (450px clear) | Pass | Pass | 12px footer too small; left 450px void; lone dot (cut) |
| `linkedin-banner.png` | 1584x396 | Opened | No | Pass (450px clear) | Pass | Pass | 12px footer too small; left 450px void; lone dot (cut) |
| `cc-mark-16.png` | 16x16 | Opened | Edge-to-edge | N/A | **Fail** (Tile shape) | N/A | Only top-left corner is rounded |
| `cc-mark-32.png` | 32x32 | Opened | Edge-to-edge | N/A | **Fail** (Tile shape) | N/A | Only top-left corner is rounded |
| `cc-mark-64.png` | 64x64 | Opened | Edge-to-edge | N/A | **Fail** (Tile shape) | N/A | Only top-left corner is rounded |
| `cc-mark-1024.png` | 1024x1024 | Opened | Edge-to-edge | N/A | **Fail** (Tile shape) | N/A | Only top-left corner is rounded (`rect width="1024"` bug) |
| `site-1280-dark.png` | 1280x800 | Opened | No (100px margins) | N/A | Pass | Pass | None |
| `site-1280-light.png` | 1280x800 | Opened | No (100px margins) | N/A | Pass | Pass | Ink tile used in light mode |
| `site-360-light.png` | 600x5600 | Opened | Yes (16px mobile) | N/A | Pass | Pass | Install box clipped; pre code clipped; 5600px cutoff |
| `site-360-dark.png` | 600x5600 | Opened | Yes (16px mobile) | N/A | Pass | Pass | Install box clipped; pre code clipped; 5600px cutoff |
