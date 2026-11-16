import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../src/redact.ts';

// Masks := operator assignments with quoted and unquoted values.
test('masks := operator with quoted and unquoted values', () => {
  assert.equal(scrub('password := "hunter2longvalue"'), 'password := "[secret]"');
  assert.equal(scrub('password := hunter2longvalue'), 'password := [secret]');
});

// Masks => operator assignments with quoted and unquoted values.
test('masks => operator with quoted and unquoted values', () => {
  assert.equal(scrub('"api_key" => "sk-abcdef0123456789"'), '"api_key" => "[secret]"');
  assert.equal(scrub('api_key => hunter2longvalue'), 'api_key => [secret]');
  assert.equal(scrub("'password' => 'hunter2pw'"), "'password' => '[secret]'");
});

// Masks == comparison operator with quoted and unquoted values.
test('masks == comparison operator with quoted and unquoted values', () => {
  assert.equal(scrub('token == "s3cr3tTokenValue99"'), 'token == "[secret]"');
  assert.equal(scrub('token == s3cr3tTokenValue99'), 'token == [secret]');
  assert.equal(scrub('if (password == "hunter2pw")'), 'if (password == "[secret]")');
});

// Masks typed assignments where credential keys have type annotations before =.
test('masks typed assignments for credential keys', () => {
  assert.equal(scrub('password: str = "hunter2pw"'), 'password: str = "[secret]"');
  assert.equal(scrub('const password: string = "hunter2longvalue"'), 'const password: string = "[secret]"');
  assert.equal(scrub('const password: string = hunter2longvalue'), 'const password: string = [secret]');
});

// Leaves non-credential keys using := and == operators untouched.
test('leaves non-credential keys with := and == alone', () => {
  assert.equal(scrub('count := 5'), 'count := 5');
  assert.equal(scrub('a == b'), 'a == b');
  assert.equal(scrub('total := 10'), 'total := 10');
  assert.equal(scrub('threshold == 100'), 'threshold == 100');
});

// Leaves arrow functions and comparisons in ordinary non-credential code untouched.
test('leaves arrow functions and comparisons in ordinary code alone', () => {
  assert.equal(scrub('items.map((x) => x.id)'), 'items.map((x) => x.id)');
  assert.equal(scrub('if (status == 200)'), 'if (status == 200)');
  assert.equal(scrub('const getCount = (record) => record.count'), 'const getCount = (record) => record.count');
});

// Verifies existing key: value and key=value masking continues to work.
test('preserves existing key: value and key=value masking', () => {
  assert.equal(scrub('password: "hunter2longvalue"'), 'password: "[secret]"');
  assert.equal(scrub('password: hunter2longvalue'), 'password: [secret]');
  assert.equal(scrub('password="hunter2longvalue"'), 'password="[secret]"');
  assert.equal(scrub('password=hunter2longvalue'), 'password=[secret]');
  assert.equal(scrub('api_key: "abcdef123456"'), 'api_key: "[secret]"');
  assert.equal(scrub('token: s3cr3tTokenValue99'), 'token: [secret]');
  assert.equal(scrub('DB_PASSWORD=aB3(xY9!kq'), 'DB_PASSWORD=[secret]');
  assert.equal(scrub('DB_PASSWORD=84726193'), 'DB_PASSWORD=[secret]');
});
