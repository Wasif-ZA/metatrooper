export function addItem(list, text) {
  const item = text.trim();
  return item ? [...list, item] : list;
}

export function countLabel(n) {
  return n === 1 ? '1 item' : `${n} items`;
}
