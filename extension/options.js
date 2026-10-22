const key = document.querySelector('#key');
const model = document.querySelector('#model');
const provider = document.querySelector('#provider');
const status = document.querySelector('#status');
const form = document.querySelector('#settings');
const availableModels = document.querySelector('#available-models');
const loadModels = document.querySelector('#load-models');
let settings = {};
let generation = 0;
form.querySelector('button[type=submit]').disabled = true;

async function showProvider() {
  const current = ++generation;
  const selected = provider.value;
  key.value = '';
  availableModels.replaceChildren(new Option('Chargez la liste avec votre clé', ''));
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

availableModels.onchange = () => {
  if (availableModels.value) model.value = availableModels.value;
};
loadModels.onclick = async () => {
  const selected = provider.value;
  const config = MoodleIAProviders[selected];
  const current = generation;
  loadModels.disabled = true;
  status.textContent = 'Chargement des modèles…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const keys = await chrome.storage.session.get(['apiKey', `apiKey_${selected}`]);
    const apiKey = key.value.trim() || keys[`apiKey_${selected}`] || (selected === 'openai' ? keys.apiKey : undefined);
    if (!apiKey) throw new Error(`Saisissez votre clé ${config.name} avant de charger les modèles.`);
    const response = await fetch(config.endpoint.replace(/\/chat\/completions$/, '/models'), {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal
    });
    if (!response.ok) {
      const errors = { 401: 'Clé refusée. Vérifiez la clé du fournisseur sélectionné.', 403: 'Accès refusé pour ce compte.', 429: 'Limite de requêtes atteinte. Réessayez plus tard.' };
      throw new Error(errors[response.status] || `Chargement impossible (HTTP ${response.status}).`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Liste de modèles invalide.');
    const ids = [...new Set(payload.data.filter(item => item && item.active !== false && typeof item.id === 'string')
      .map(item => item.id).filter(id => !/whisper|tts|speech|audio|guard|embed|safety/i.test(id)))].sort();
    if (!ids.length) throw new Error('Aucun modèle de conversation reconnu dans la liste. Vérifiez votre compte fournisseur.');
    if (current !== generation) return;
    availableModels.replaceChildren(new Option('Choisir un modèle', ''), ...ids.map(id => new Option(id, id)));
    const preferred = [model.value, config.model, 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']
      .find(id => ids.includes(id));
    if (preferred) {
      availableModels.value = preferred;
      model.value = preferred;
    } else model.value = '';
    status.textContent = `${ids.length} modèle(s) chargé(s). Choisissez un modèle puis cliquez sur Enregistrer.`;
  } catch (error) {
    if (current === generation) status.textContent = error.name === 'AbortError' ? 'Délai de chargement dépassé. Réessayez.' : error.message;
  } finally {
    clearTimeout(timeout);
    loadModels.disabled = false;
  }
};
