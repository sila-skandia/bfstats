'use strict';

const api = window.sidecarApp;
const input = document.getElementById('address');
const error = document.getElementById('error');

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const r = await api.join(input.value);
  if (r.ok) api.closeWindow();
  else error.textContent = r.error;
});
document.getElementById('cancel').addEventListener('click', () => api.closeWindow());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.closeWindow(); });
