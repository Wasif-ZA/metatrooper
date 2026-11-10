export interface LoadedDoc {
  url: string;
  status: number | null;
  headers: Record<string, string>;
  main: boolean;
}

function frameVendor(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname;
  if (h === 'geo.captcha-delivery.com') return 'DataDome';
  if (h.endsWith('.arkoselabs.com')) return 'Arkose';
  if (h.endsWith('.hcaptcha.com') && new URLSearchParams(u.hash.slice(1)).get('frame') === 'challenge') return 'hCaptcha';
  if (h === 'captcha.px-cdn.net') return 'PerimeterX';
  return null;
}

/** Names the human check a loaded document is showing, or null. Detects only; nothing here answers a check. */
// ponytail: block pages and challenge frames only; in-form widgets (reCAPTCHA, Turnstile) pass unseen, add a visible-widget probe if agents stall on them
export function challengeOf(doc: LoadedDoc): string | null {
  if (!doc.main) return frameVendor(doc.url);
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.headers)) h[k.toLowerCase()] = String(v);
  if (h['cf-mitigated'] === 'challenge') return 'Cloudflare';
  if (doc.status !== 403 && doc.status !== 429) return null;
  if (/akamaighost/i.test(h.server ?? '')) return 'Akamai';
  if ('x-datadome' in h || /datadome/i.test(h['set-cookie'] ?? '')) return 'DataDome';
  return null;
}

/** The pane's user agent: Chromium's own string without the Electron and app-name product tokens. The Chromium version is left as it is. */
export function plainUserAgent(ua: string): string {
  return ua.replace(/ Electron\/\S+/g, '').replace(/(\(KHTML, like Gecko\)) \S+(?= Chrome\/)/, '$1');
}
