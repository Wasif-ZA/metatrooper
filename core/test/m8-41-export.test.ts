import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTest, type Step } from '../src/browser/export-test.ts';

const HEAD = "import { test } from '@playwright/test';\n\ntest('recorded by Ouros', async ({ page }) => {\n";
const TAIL = '});\n';

// protects=with nothing recorded the test body is the single line the spec gives
// fails_when=the body is empty, or the placeholder line differs from // nothing recorded yet
// no_claim=the import line and test title (checked by the full-file case)
test('M8-41d empty steps give the nothing-recorded body', () => {
  assert.equal(exportTest([]), `${HEAD}  // nothing recorded yet\n${TAIL}`);
});

// protects=navigate and a button click produce the spec's example file exactly, with JSON-quoted strings and exact:true
// fails_when=any line, the import, the title, or the trailing newline differs from the spec example
// no_claim=the scrub of the URL (done before export, in the MCP shim)
test('M8-41d navigate plus click on button Next gives the spec example file', () => {
  const steps: Step[] = [
    { tool: 'navigate', url: 'http://localhost:4123/' },
    { tool: 'click', role: 'button', name: 'Next' },
  ];
  assert.equal(
    exportTest(steps),
    `${HEAD}  await page.goto("http://localhost:4123/");\n  await page.getByRole("button", { name: "Next", exact: true }).click();\n${TAIL}`,
  );
});

// protects=each type step fills from its own numbered env var, counting from 1
// fails_when=both fills use MT_FILL_1, or the second one is not MT_FILL_2
// no_claim=the submit press (covered by the submit case)
test('M8-41d two type steps use MT_FILL_1 then MT_FILL_2', () => {
  const steps: Step[] = [
    { tool: 'type', role: 'textbox', name: 'Email' },
    { tool: 'type', role: 'textbox', name: 'Password' },
  ];
  const text = exportTest(steps);
  assert.ok(text.includes(`  await page.getByRole("textbox", { name: "Email", exact: true }).fill(process.env.MT_FILL_1 ?? '');\n`), text);
  assert.ok(text.includes(`  await page.getByRole("textbox", { name: "Password", exact: true }).fill(process.env.MT_FILL_2 ?? '');\n`), text);
});

// protects=a type step with submit also presses Enter on the same locator, after the fill
// fails_when=no press line appears, or the press is on a different locator or before the fill
// no_claim=the Enter key handling of the key tool (see the key cases)
test('M8-41d a type step with submit adds a press Enter line', () => {
  const steps: Step[] = [{ tool: 'type', role: 'textbox', name: 'Search', submit: true }];
  assert.equal(
    exportTest(steps),
    `${HEAD}  await page.getByRole("textbox", { name: "Search", exact: true }).fill(process.env.MT_FILL_1 ?? '');\n  await page.getByRole("textbox", { name: "Search", exact: true }).press('Enter');\n${TAIL}`,
  );
});

// protects=a role the snapshot does not give refs to falls back to getByText with the name
// fails_when=the locator is getByRole for a clickable, or the name is dropped
// no_claim=which roles get refs (that is ACTIONABLE in snapshot.ts)
test('M8-41d a clickable role falls back to getByText', () => {
  const steps: Step[] = [{ tool: 'click', role: 'clickable', name: 'Open settings' }];
  assert.equal(
    exportTest(steps),
    `${HEAD}  await page.getByText("Open settings", { exact: true }).click();\n${TAIL}`,
  );
});

// protects=a step with an empty name is not written as a locator; it becomes a comment saying so
// fails_when=an empty name produces a getByRole or getByText line, or the comment text differs
// no_claim=the comment for a non-click tool (the same branch applies to every tool)
test('M8-41d an empty name gives the no-name comment', () => {
  const steps: Step[] = [{ tool: 'click', role: 'button', name: '' }];
  assert.equal(
    exportTest(steps),
    `${HEAD}  // a click on an element with no name was not recorded\n${TAIL}`,
  );
});

// protects=a one-character key is not recorded and leaves the spec's comment line
// fails_when=key a becomes a page.keyboard.press line, or no comment appears
// no_claim=the modifier handling beyond the last part after + (the Control+Enter case)
test('M8-41d key a gives the key-not-recorded comment', () => {
  const steps: Step[] = [{ tool: 'key', keys: 'a' }];
  assert.equal(exportTest(steps), `${HEAD}  // a key press was not recorded\n${TAIL}`);
});

// protects=named keys, alone or with modifiers, are recorded as page.keyboard.press with the key string JSON-quoted
// fails_when=Enter or Control+Enter is missing, or is recorded in a different form
// no_claim=which named keys the list holds beyond Enter (the NAMED list in export-test.ts)
test('M8-41d key Enter and Control+Enter give page.keyboard.press lines', () => {
  assert.equal(exportTest([{ tool: 'key', keys: 'Enter' }]), `${HEAD}  await page.keyboard.press("Enter");\n${TAIL}`);
  assert.equal(exportTest([{ tool: 'key', keys: 'Control+Enter' }]), `${HEAD}  await page.keyboard.press("Control+Enter");\n${TAIL}`);
});

// protects=strings containing quotes are written with JSON.stringify, so the file stays valid TypeScript
// fails_when=a name or url with a quote is written raw and breaks the string literal
// no_claim=the scrub of secrets from the URL (the redact tests cover scrub)
test('M8-41d strings with quotes are JSON-escaped', () => {
  const steps: Step[] = [
    { tool: 'navigate', url: 'http://localhost/?q="x"' },
    { tool: 'click', role: 'button', name: 'Say "hi"' },
  ];
  assert.equal(
    exportTest(steps),
    `${HEAD}  await page.goto("http://localhost/?q=\\"x\\"");\n  await page.getByRole("button", { name: "Say \\"hi\\"", exact: true }).click();\n${TAIL}`,
  );
});

// protects=the typed text never reaches the export: a type step has no text field, so a record that held text does not leak it
// fails_when=the output contains hunter2-secret, or any character of the typed text
// no_claim=the MCP shim's own record (the shim strips text before it calls exportTest); this covers only exportTest
test('M8-41d guard: a typed text in the record never reaches the export', () => {
  const record = { tool: 'type', role: 'textbox', name: 'Password', text: 'hunter2-secret' } as unknown as Step;
  const text = exportTest([record]);
  assert.ok(!text.includes('hunter2-secret'), text);
  assert.ok(!text.includes('hunter2'), text);
  assert.ok(text.includes(".fill(process.env.MT_FILL_1 ?? '');"), text);
});
