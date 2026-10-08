import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class ApiError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

export const PLATFORMS = {
  tiktok: {
    identifiers: ['tiktok'],
    settings: () => ({
      __type: 'tiktok', title: '', privacy_level: 'PUBLIC_TO_EVERYONE', duet: false, stitch: false, comment: true, autoAddMusic: 'no',
      brand_content_toggle: false, brand_organic_toggle: false, video_made_with_ai: false, content_posting_method: 'DIRECT_POST',
    }),
  },
  'youtube-shorts': {
    identifiers: ['youtube'],
    settings: (p) => ({ __type: 'youtube', title: p.title, type: 'public' }),
  },
  'instagram-reels': {
    identifiers: ['instagram', 'instagram-standalone'],
    settings: (p, identifier) => ({ __type: identifier, post_type: 'post' }),
  },
};

const SLOT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}:\d{2}$/;

export function realApi(env = process.env) {
  for (const k of ['POSTIZ_URL', 'POSTIZ_API_KEY']) {
    if (!env[k]) throw new ApiError(`${k} is not set: run troop plugin secret social-scheduler ${k}`, false);
  }
  const base = env.POSTIZ_URL.replace(/\/+$/, '');
  return async (method, route, body) => {
    const headers = { authorization: env.POSTIZ_API_KEY };
    if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(`${base}/${route}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new ApiError(`Postiz could not be reached at ${base}: ${e.message}`, true);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(`Postiz ${method} ${route} failed: ${j.message || j.error || r.status}`, r.status === 429 || r.status >= 500);
    return j;
  };
}

export function content(p) {
  const tags = (p.hashtags || []).map((t) => `#${String(t).replace(/^#/, '')}`).join(' ');
  return tags ? `${p.caption.trim()}\n\n${tags}` : p.caption.trim();
}

export function refusal(p, runDir, now = new Date()) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (!PLATFORMS[p.platform]) return `unknown platform ${JSON.stringify(p.platform ?? '')}, use one of ${Object.keys(PLATFORMS).join(', ')}`;
  const clip = path.resolve(runDir, String(p.clip || ''));
  if (!p.clip || !/\.mp4$/i.test(clip) || !fs.existsSync(clip)) return `clip ${JSON.stringify(p.clip ?? '')} is not an mp4 file`;
  if (!SLOT.test(String(p.slot || ''))) return `slot ${JSON.stringify(p.slot ?? '')} is not ISO with an offset`;
  if (new Date(p.slot) <= now) return `slot ${p.slot} is in the past`;
  if (!String(p.caption || '').trim()) return 'empty caption';
  if (p.platform === 'youtube-shorts' && !(String(p.title || '').trim().length >= 2 && p.title.length <= 100)) return 'YouTube title must be 2 to 100 characters';
  if (/\{\{|\}\}/.test(`${p.title ?? ''}${p.caption}`)) return 'unfilled template text';
  return null;
}

export async function schedulePost(input, api, runDir = process.env.TROOP_RUN_DIR || '.', now = new Date()) {
  const list = JSON.parse(fs.readFileSync(path.resolve(runDir, input.posts), 'utf8'));
  if (!Array.isArray(list) || !list.length) throw new ApiError(`${input.posts} is not a non-empty JSON list`, false);
  const integrations = (await api('GET', 'integrations')).filter((i) => !i.disabled);
  const target = (p) => integrations.find((i) => PLATFORMS[p.platform].identifiers.includes(i.identifier));
  const refused = list.map((p, i) => {
    const label = `${p?.clip ?? `#${i}`} ${p?.platform ?? ''}`.trim();
    const why = refusal(p, runDir, now) ?? (target(p) ? null : `no connected ${p.platform} account in Postiz`);
    return why ? `${label}: ${why}` : null;
  }).filter(Boolean);
  if (refused.length) throw new ApiError(`refused, nothing scheduled: ${refused.join('; ')}`, false);

  const uploads = new Map();
  const scheduled = [];
  try {
    for (const p of list) {
      const clip = path.resolve(runDir, p.clip);
      if (!uploads.has(clip)) {
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(clip)], { type: 'video/mp4' }), path.basename(clip));
        const u = await api('POST', 'upload', form);
        uploads.set(clip, { id: u.id, path: u.path });
      }
      const integration = target(p);
      const r = await api('POST', 'posts', {
        type: 'schedule', date: new Date(p.slot).toISOString(), shortLink: false, tags: [],
        posts: [{ integration: { id: integration.id }, value: [{ content: content(p), image: [uploads.get(clip)] }], settings: PLATFORMS[p.platform].settings(p, integration.identifier) }],
      });
      scheduled.push({ clip: p.clip, platform: p.platform, slot: p.slot, post_id: r?.[0]?.postId ?? null });
      process.stderr.write(`scheduled ${p.clip} on ${p.platform} for ${p.slot}\n`);
    }
  } catch (e) {
    if (!scheduled.length) throw e;
    throw new ApiError(`${e.message}. Already scheduled, delete these in Postiz before a rerun: ${scheduled.map((s) => `${s.clip} ${s.platform} ${s.post_id ?? '(no id)'}`).join('; ')}`, false);
  }
  return { count: scheduled.length, posts: scheduled };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    if (process.argv[2] !== 'schedule-post') throw new ApiError(`unknown action ${process.argv[2]}`, false);
    const outputs = await schedulePost(req.input || {}, realApi(), req.run?.dir || process.env.TROOP_RUN_DIR || '.');
    process.stdout.write(JSON.stringify({ ok: true, outputs }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e.message, retryable: Boolean(e.retryable) } }));
    process.exitCode = 1;
  }
}
