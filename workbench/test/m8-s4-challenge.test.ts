import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeOf, plainUserAgent, type LoadedDoc } from '../src/browser/challenge.ts';

const agents = [
  ['scoped app name', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) @metatrooper/workbench/0.1.0 Chrome/142.0.7444.59 Electron/44.4.5 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36'],
  ['plain Chromium unchanged', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36'],
  ['another platform and version', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ouros/9.7 Chrome/131.0.6778.205 Electron/33.3.1 Safari/537.36', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.205 Safari/537.36'],
  ['empty input', '', ''],
];
for (const [name, input, expected] of agents) {
  test('plainUserAgent: ' + name, () => assert.equal(plainUserAgent(input), expected));
}

const agentBugs = [
  ['Electron product token at end is not removed', 'Mozilla/5.0 Chrome/142.0.7444.59 Safari/537.36 Electron/44.4.5', 'Mozilla/5.0 Chrome/142.0.7444.59 Safari/537.36'],
  ['unrelated Edg product is removed from an already plain UA', 'Mozilla/5.0 Chrome/142.0.7444.59 Edg/142.0.3595.53 Safari/537.36', 'Mozilla/5.0 Chrome/142.0.7444.59 Edg/142.0.3595.53 Safari/537.36'],
];
for (const [bug, input, expected] of agentBugs) {
  test('plainUserAgent: ' + bug, () => assert.equal(plainUserAgent(input), expected));
}

const documents: Array<[string, LoadedDoc, string | null]> = [
  ['Cloudflare 200 mixed header case', { main: true, url: 'https://shop.example/', status: 200, headers: { 'Cf-MiTiGaTeD': 'challenge' } }, 'Cloudflare'],
  ['Cloudflare 503', { main: true, url: 'https://shop.example/', status: 503, headers: { 'cf-mitigated': 'challenge' } }, 'Cloudflare'],
  ['Cloudflare null status', { main: true, url: 'https://shop.example/', status: null, headers: { 'CF-MITIGATED': 'challenge' } }, 'Cloudflare'],
  ['Akamai 403', { main: true, url: 'https://shop.example/', status: 403, headers: { Server: 'AkamaiGHost' } }, 'Akamai'],
  ['Akamai 429 case insensitive value', { main: true, url: 'https://shop.example/', status: 429, headers: { SERVER: 'edge aKaMaIgHoSt proxy' } }, 'Akamai'],
  ['Akamai 200', { main: true, url: 'https://shop.example/', status: 200, headers: { server: 'AkamaiGHost' } }, null],
  ['DataDome 403 header', { main: true, url: 'https://shop.example/', status: 403, headers: { 'X-DaTaDoMe': 'present' } }, 'DataDome'],
  ['DataDome 429 header', { main: true, url: 'https://shop.example/', status: 429, headers: { 'x-datadome': 'present' } }, 'DataDome'],
  ['DataDome 429 cookie', { main: true, url: 'https://shop.example/', status: 429, headers: { 'SET-COOKIE': 'datadome=synthetic; Path=/; Secure' } }, 'DataDome'],
  ['DataDome 403 cookie', { main: true, url: 'https://shop.example/', status: 403, headers: { 'Set-Cookie': 'other=1; DATADOME=synthetic' } }, 'DataDome'],
  ['DataDome 200 header', { main: true, url: 'https://shop.example/', status: 200, headers: { 'x-datadome': 'present' } }, null],
  ['DataDome 200 cookie', { main: true, url: 'https://shop.example/', status: 200, headers: { 'set-cookie': 'datadome=synthetic' } }, null],
  ['empty headers 403', { main: true, url: 'https://shop.example/', status: 403, headers: {} }, null],
  ['empty headers 429', { main: true, url: 'https://shop.example/', status: 429, headers: {} }, null],
  ['main frame ignores challenge URL', { main: true, url: 'https://geo.captcha-delivery.com/check', status: 200, headers: {} }, null],
];
for (const [name, doc, expected] of documents) {
  test('challengeOf main: ' + name, () => assert.equal(challengeOf(doc), expected));
}

test('challengeOf: an empty x-datadome header is missed on a 403', () => {
  assert.equal(challengeOf({ main: true, url: 'https://shop.example/', status: 403, headers: { 'x-datadome': '' } }), 'DataDome');
});

const frames: Array<[string, string | null]> = [
  ['https://geo.captcha-delivery.com/check', 'DataDome'],
  ['https://client.arkoselabs.com/check', 'Arkose'],
  ['https://a.b.arkoselabs.com/check', 'Arkose'],
  ['https://newassets.hcaptcha.com/check#id=1&frame=challenge', 'hCaptcha'],
  ['https://newassets.hcaptcha.com/check#frame=checkbox', null],
  ['https://newassets.hcaptcha.com/check?frame=challenge', null],
  ['https://newassets.hcaptcha.com/check', null],
  ['https://captcha.px-cdn.net/check', 'PerimeterX'],
  ['https://ordinary.example/check', null],
  ['http://geo.captcha-delivery.com/check', null],
  ['http://client.arkoselabs.com/check', null],
  ['http://newassets.hcaptcha.com/check#frame=challenge', null],
  ['http://captcha.px-cdn.net/check', null],
  ['https://geo.captcha-delivery.com.evil.example/check', null],
  ['https://client.arkoselabs.com.evil.example/check', null],
  ['https://newassets.hcaptcha.com.evil.example/check#frame=challenge', null],
  ['https://captcha.px-cdn.net.evil.example/check', null],
  ['https://notarkoselabs.com/check', null],
  ['https://nothcaptcha.com/check#frame=challenge', null],
];
for (const [url, expected] of frames) {
  for (const [status, headers] of [[200, {}], [403, { 'cf-mitigated': 'challenge', Server: 'AkamaiGHost', 'x-datadome': 'synthetic' }]] as const) {
    test('challengeOf subframe: ' + url + ' status ' + status, () => {
      assert.equal(challengeOf({ url, main: false, status, headers }), expected);
    });
  }
}

const frameBugs = [
  ['Arkose domain in query is mistaken for the hostname', 'https://evil.example?next=.arkoselabs.com/check'],
  ['hCaptcha domain in query is mistaken for the hostname', 'https://evil.example?next=.hcaptcha.com/check#frame=challenge'],
  ['hCaptcha accepts a different fragment value', 'https://newassets.hcaptcha.com/check#frame=challenge-other'],
  ['hCaptcha accepts a different fragment key', 'https://newassets.hcaptcha.com/check#notframe=challenge'],
];
for (const [bug, url] of frameBugs) {
  for (const status of [200, 403]) {
    test('challengeOf: ' + bug + ' status ' + status, () => {
      assert.equal(challengeOf({ url, main: false, status, headers: {} }), null);
    });
  }
}
