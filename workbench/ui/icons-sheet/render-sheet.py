"""Raster review fallback when Windows blocks Chromium's IPC startup.

Uses PyMuPDF already installed on this machine; no package installation.
Reads the inline SVGs in sheet.html, preserving their geometry and styles.
These PNGs are SVG contact sheets, not browser screenshots of the HTML.
Preferred screenshot command (run separately for dark and light):
  msedge --headless --screenshot=<absolute PNG path> --window-size=1400,1800 \
    --force-device-scale-factor=1 file:///.../sheet.html?theme=dark
"""
from pathlib import Path
import html
import re
import xml.etree.ElementTree as ET
import pymupdf as fitz

ROOT = Path(__file__).resolve().parent
PAGE = (ROOT / 'sheet.html').read_text(encoding='utf-8')
SECTIONS = re.findall(r'<section><h2>.*?</section>', PAGE, re.S)
NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', 'http://www.w3.org/2000/svg')


def icon(markup, x, y, size, color):
    root = ET.fromstring(markup.replace('currentColor', color))
    attrs = {k: v for k, v in root.attrib.items()
             if k in ('fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin')}
    group = ET.Element('g', {**attrs, 'transform': f'translate({x} {y}) scale({size / 16})'})
    for child in root:
        if child.tag != NS + 'title':
            group.append(child)
    return ET.tostring(group, encoding='unicode')


def render(theme):
    dark = theme == 'dark'
    bg, fg, muted, line, surface = (
        ('#0b0b0c', '#e6e6e6', '#99999f', '#29292c', '#111113') if dark else
        ('#fafafa', '#202024', '#64646c', '#dcdce0', '#ffffff'))
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800" viewBox="0 0 1400 1800">']

    def rect(x, y, w, h, fill, stroke='none', radius=0):
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>')

    def text(value, x, y, size=12, color=fg, anchor='start', weight='400'):
        parts.append(f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{html.escape(value)}</text>')

    rect(0, 0, 1400, 1800, bg)
    text('OUROS / INTERFACE ASSETS', 48, 53, 11, muted)
    text('Needs you', 48, 91, 28, weight='600')
    text('16 px grid · 1.5 stroke · Round caps & joins · currentColor', 48, 117, 12, muted)
    rect(48, 140, 1304, 1, line)
    for n, label in enumerate(('Dark', 'Light')):
        x = 1222 + n * 68
        rect(x, 72, 62, 31, line if label.lower() == theme else bg, line, 5)
        text(label, x + 31, 92, 12, anchor='middle')

    y = 168
    count = 0
    for i, section in enumerate(SECTIONS):
        heading = re.search(r'</span>(.*?)<small>', section).group(1)
        cards = re.findall(r'<figure>(.*?)</figure>', section, re.S)
        text(f'0{i + 1}', 48, y, 11, muted)
        text(heading, 77, y, 13, weight='600')
        text(f'{len(cards)} marks', 1352, y, 11, muted, 'end')
        top = y + 12
        for j, card in enumerate(cards):
            x, cy = 48 + (j % 7) * 188, top + (j // 7) * 126
            rect(x + .5, cy + .5, 175, 113, surface, line, 6)
            svgs = re.findall(r'<svg\b.*?</svg>', card, re.S)
            assert len(svgs) == 3
            for k, (size, svg) in enumerate(zip((16, 20, 32), svgs)):
                cx = x + 40 + k * 48
                parts.append(icon(svg, cx - size / 2, cy + 33 - size / 2, size, fg))
                text(str(size), cx, cy + 66, 10, muted, 'middle')
                count += 1
            name = html.unescape(re.search(r'<figcaption>(.*?)</figcaption>', card).group(1))
            text(name, x + 88, cy + 94, 11, anchor='middle')
        y = top + ((len(cards) + 6) // 7) * 126 + 16

    empty = re.search(r'<div class="empty-note">(<svg\b.*?</svg>)', PAGE, re.S).group(1)
    rect(48, y, 1304, 1, line)
    parts.append(icon(empty, 48, y + 14, 64, muted))
    text('NothingNeedsYou / native 64 px', 132, y + 40, 12, muted)
    text('Same 16 px geometry, scaled with its stroke.', 132, y + 58, 12, muted)
    rect(48, y + 92, 1304, 1, line)
    text('Exact component SVGs / local SVG raster fallback / browser IPC access denied', 48, y + 116, 11, muted)
    text('InReview: half-ring hatching preserves the no-fill rule.', 1352, y + 116, 11, muted, 'end')
    parts.append('</svg>')
    assert y + 116 < 1800, 'Sheet must fit the requested canvas'
    document = fitz.open(stream=''.join(parts).encode('utf-8'), filetype='svg')
    pix = document[0].get_pixmap(alpha=False)
    assert (pix.width, pix.height) == (1400, 1800)
    output = ROOT / f'sheet-{theme}.png'
    pix.save(output)
    print(f'{output.name}: {count} samples, 1400 x 1800; SVG fallback')


for theme in ('dark', 'light'):
    render(theme)
