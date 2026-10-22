const key = document.querySelector('#key');
const model = document.querySelector('#model');
const status = document.querySelector('#status');
chrome.storage.local.get('model').then(data => { if (data.model) model.value = data.model; });
chrome.storage.session.get('apiKey').then(data => {
  status.textContent = data.apiKey ? 'Une clé est disponible pour cette session.' : 'Aucune clé enregistrée pour cette session.';
});
document.querySelector('#settings').onsubmit = async event => {
  event.preventDefault();
  try {
    if (key.value.trim()) await chrome.storage.session.set({ apiKey: key.value.trim() });
    await chrome.storage.local.set({ model: model.value.trim() });
    key.value = '';
    status.textContent = 'Réglages enregistrés.';
  } catch { status.textContent = 'Enregistrement impossible. Rechargez l’extension.'; }
};
document.querySelector('#clear').onclick = async () => {
  await chrome.storage.session.remove('apiKey');
  key.value = '';
  status.textContent = 'Clé effacée.';
};
