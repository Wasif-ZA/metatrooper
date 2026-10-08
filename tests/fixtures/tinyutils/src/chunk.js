export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length - size; i += size) out.push(items.slice(i, i + size));
  return out;
}
