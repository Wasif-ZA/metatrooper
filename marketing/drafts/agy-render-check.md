# Render Check Report

This report checks the HTML launch post renders and the asset screenshots.
cc is not affiliated with Anthropic, OpenAI or Google.
The project is pre-release version 0.1.0 for Windows only, installed from source.

## Part A: HTML Renders

Renders checked:
- `C:/Users/wasif/.cache/claude-scratch/cc-launch-2026-11-18/render-light.png`
- `C:/Users/wasif/.cache/claude-scratch/cc-launch-2026-11-18/render-dark.png`
- `C:/Users/wasif/.cache/claude-scratch/cc-launch-2026-11-18/render-375.png`

### Theme Check
`render-dark.png` is in dark theme.
The page uses ink background `#151516`, paper text `#f1f1ef`, surface `#242426`, and wait orange accent `#ff7a1a`.

### Topbar
- Fault in `render-375.png`: The header content overflows horizontally past the 375px viewport.
- Fault in `render-375.png`: The "Copy all" button is clipped on the right.
- Fault in `render-375.png`: The "Theme" button is pushed completely off screen and is unreachable.
- Fault in `render-dark.png`: The logo mark SVG uses a dark tile `#151516` that matches the dark topbar background `#151516`. The rounded tile outline disappears into the background.
- Fault in `render-light.png`: The logo mark SVG embeds the dark tile with dark wait orange `#ff7a1a`. It does not use `cc-mark-ink.svg` or light wait orange `#c45200`.

### Intro
- Fault in `render-375.png`: The heading `<h1>Launch posts, ready to paste</h1>` is clipped on the right edge.
- Fault in `render-375.png`: The intro paragraph text is clipped on the right edge.

### Read first
- Fault in `render-375.png`: The note paragraph is clipped on the right edge.
- Fault in `render-375.png`: All five bullet items in the list are clipped on the right edge.

### Contents (Table of contents / nav)
- Fault in `render-375.png`: In mobile layout, the navigation container has a fixed maximum height of 8rem.
- Fault in `render-375.png`: Only the first six section links are visible.
- Fault in `render-375.png`: The remaining six section links are cut off and hidden below the scroll area.

### Show HN (and other post sections)
- Fault in `render-375.png`: The note text is clipped on the right edge.
- Fault in `render-375.png`: The preformatted text inside post cards overflows horizontally and is clipped on the right edge.
- Fault in `render-375.png`: The character counter in the Title post card (`59 / 80`) is pushed completely off screen.
- Fault in `render-375.png`: The character counter in the First comment post card (`1882 / 4000`) is pushed completely off screen.
- Fault in `render-375.png`: The right borders of post cards extend beyond the right edge of the viewport.

### Contrast and Readability
- Contrast is good in both `render-light.png` and `render-dark.png`.
- Text is sharp and readable at 1280px width.
- Layout at 1280px has no overlapping elements.

## Part B: Screenshot Inspection

`assets/ouros/today.png`: Shows the product name "OUROS" in the top bar, displays mock data (such as "linkkit" tasks and overnight stats), and looks like a design mockup.
`assets/ouros/ide.png`: Shows the product name "OUROS" in the top bar, displays mock data (such as code editing in "linkkit" and sample test failures), and looks like a design mockup.
`assets/ouros/wall.png`: Shows the product name "OUROS" in the top bar, displays mock data (such as sample terminal sessions for claude, codex, and gemini), and looks like a design mockup.
`assets/ouros/jobs.png`: Shows the product name "OUROS" in the top bar of each window tile, displays mock data (such as sample spreadsheet, sales pipeline, poster, and UI design tasks), and looks like a design mockup.
`assets/ouros/review.png`: Shows the product name "OUROS" in the top bar, displays mock data (such as sample code diffs and simulated reviewer checks), and looks like a design mockup.
`assets/ouros/rewind.png`: Shows the product name "OUROS" in the top bar and prompt text, displays mock data (such as sample checkpoints and diff lines), and looks like a design mockup.
