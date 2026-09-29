type Schema = Record<string, unknown> | boolean;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(want: string, v: unknown): boolean {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pointer(pathParts: Array<string | number>): string {
  return pathParts.length ? '/' + pathParts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '/';
}

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith('#')) throw new Error(`unsupported $ref ${ref}`);
  let node: unknown = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Record<string, unknown>)?.[key];
  }
  if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  return node as Schema;
}

/** Validates data against the JSON Schema 2020-12 subset the contracts use; returns "<pointer>: <message>" strings. */
export function validate(schema: Schema, data: unknown, root: Schema = schema): string[] {
  const errors: string[] = [];
  walk(schema, data, [], root, errors);
  return errors;
}

function walk(schema: Schema, v: unknown, at: Array<string | number>, root: Schema, errors: string[]): void {
  if (schema === true) return;
  const here = pointer(at);
  if (schema === false) {
    errors.push(`${here}: is not allowed`);
    return;
  }
  const s = schema;
  if (typeof s.$ref === 'string') walk(resolveRef(root, s.$ref), v, at, root, errors);

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => typeMatches(t, v))) {
      errors.push(`${here}: must be ${types.join(' or ')}`);
      return;
    }
  }
  if ('const' in s && !equal(s.const, v)) errors.push(`${here}: must equal ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => equal(e, v))) errors.push(`${here}: must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);

  if (typeof v === 'string') {
    if (typeof s.minLength === 'number' && [...v].length < s.minLength) errors.push(`${here}: must be at least ${s.minLength} characters`);
    if (typeof s.maxLength === 'number' && [...v].length > s.maxLength) errors.push(`${here}: must be at most ${s.maxLength} characters`);
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${here}: must match ${s.pattern}`);
  }

  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) errors.push(`${here}: must be >= ${s.minimum}`);
    if (typeof s.maximum === 'number' && v > s.maximum) errors.push(`${here}: must be <= ${s.maximum}`);
  }

  if (Array.isArray(v)) {
    if (typeof s.minItems === 'number' && v.length < s.minItems) errors.push(`${here}: must have at least ${s.minItems} item${s.minItems === 1 ? '' : 's'}`);
    if (typeof s.maxItems === 'number' && v.length > s.maxItems) errors.push(`${here}: must have at most ${s.maxItems} items`);
    if (s.uniqueItems === true) {
      const seen = new Set<string>();
      v.forEach((item, i) => {
        const k = JSON.stringify(item);
        if (seen.has(k)) errors.push(`${pointer([...at, i])}: duplicate item`);
        seen.add(k);
      });
    }
    if (s.items !== undefined) v.forEach((item, i) => walk(s.items as Schema, item, [...at, i], root, errors));
  }

  if (typeOf(v) === 'object') {
    const obj = v as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const key of (s.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push(`${here}: missing required property ${key}`);
    }
    for (const [key, val] of Object.entries(obj)) {
      if (key in props) walk(props[key], val, [...at, key], root, errors);
      else if (s.additionalProperties === false) errors.push(`${pointer([...at, key])}: unknown property`);
      else if (typeof s.additionalProperties === 'object') walk(s.additionalProperties as Schema, val, [...at, key], root, errors);
    }
  }

  if (Array.isArray(s.allOf)) for (const sub of s.allOf as Schema[]) walk(sub, v, at, root, errors);
  if (Array.isArray(s.anyOf) && !(s.anyOf as Schema[]).some((sub) => validate(sub, v, root).length === 0)) {
    errors.push(`${here}: must match at least one allowed shape`);
  }
  if (Array.isArray(s.oneOf) && (s.oneOf as Schema[]).filter((sub) => validate(sub, v, root).length === 0).length !== 1) {
    errors.push(`${here}: must match exactly one allowed shape`);
  }
  if (s.not !== undefined && validate(s.not as Schema, v, root).length === 0) errors.push(`${here}: must not match the excluded shape`);
  if (s.if !== undefined) {
    const passes = validate(s.if as Schema, v, root).length === 0;
    if (passes && s.then !== undefined) walk(s.then as Schema, v, at, root, errors);
    if (!passes && s.else !== undefined) walk(s.else as Schema, v, at, root, errors);
  }
}
