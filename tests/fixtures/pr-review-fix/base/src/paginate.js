export function pageItems(items, page, size) {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

export function lastPage(count, size) {
  const pages = Math.ceil(count / size);
  return Math.max(pages, 1);
}
