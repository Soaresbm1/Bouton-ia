const key = document.querySelector('#key');
const model = document.querySelector('#model');
const provider = document.querySelector('#provider');
const status = document.querySelector('#status');
const form = document.querySelector('#settings');
let settings = {};
let generation = 0;
form.querySelector('button[type=submit]').disabled = true;

async function showProvider() {
  const current = ++generation;
  const selected = provider.value;
  key.value = '';
  model.value = settings[`model_${selected}`] || (selected === 'openai' ? settings.model : undefined) || MoodleIAProviders[selected].model;
  const keys = await chrome.storage.session.get(['apiKey', `apiKey_${selected}`]);
  if (current !== generation) return;
  const present = keys[`apiKey_${selected}`] || (selected === 'openai' && keys.apiKey);
  status.textContent = present ? `Une clé ${MoodleIAProviders[selected].name} est disponible pour cette session.` : `Saisissez votre clé ${MoodleIAProviders[selected].name}.`;
}

chrome.storage.local.get(['provider', 'model', 'model_openai', 'model_groq']).then(async data => {
  settings = data;
  provider.value = Object.hasOwn(MoodleIAProviders, data.provider) ? data.provider : 'openai';
  await showProvider();
  form.querySelector('button[type=submit]').disabled = false;
}).catch(() => { status.textContent = 'Chargement impossible. Rechargez l’extension.'; });
provider.onchange = showProvider;
form.onsubmit = async event => {
  event.preventDefault();
  const selected = provider.value;
  const chosenModel = model.value.trim();
  if (!chosenModel) { status.textContent = 'Saisissez un modèle.'; return; }
  try {
    if (key.value.trim()) await chrome.storage.session.set({ [`apiKey_${selected}`]: key.value.trim() });
    const update = { provider: selected, [`model_${selected}`]: chosenModel };
    await chrome.storage.local.set(update);
    Object.assign(settings, update);
    key.value = '';
    status.textContent = `Réglages ${MoodleIAProviders[selected].name} enregistrés.`;
  } catch { status.textContent = 'Enregistrement impossible. Rechargez l’extension.'; }
};
document.querySelector('#clear').onclick = async () => {
  const selected = provider.value;
  await chrome.storage.session.remove(selected === 'openai' ? ['apiKey_openai', 'apiKey'] : ['apiKey_groq']);
  key.value = '';
  status.textContent = `Clé ${MoodleIAProviders[selected].name} effacée.`;
};
