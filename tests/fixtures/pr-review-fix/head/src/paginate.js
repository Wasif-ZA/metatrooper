export function pageItems(items, page, size) {
  const start = page * size;
  return items.slice(start, start + size);
}

export function lastPage(count, size) {
  const pages = Math.ceil(count / size);
  return Math.max(pages, 1);
}
