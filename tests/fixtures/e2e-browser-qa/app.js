import { addItem, countLabel } from './logic.js';

let items = [];

function render() {
  document.getElementById('list').innerHTML = items.map((x) => `<li>${x.replace(/</g, '&lt;')}</li>`).join('');
  document.getElementById('count').textContent = countLabel(items.length);
}

document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('item-input');
  items = addItem(items, input.value);
  input.value = '';
  render();
});

render();
