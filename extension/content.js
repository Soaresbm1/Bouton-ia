(() => {
  if (document.getElementById('moodle-ia-extension')) return;
  if (!MoodleIA.collect(document).length) {
    alert('Aucune question reconnue. Ouvrez un entraînement avec ses questions affichées. Les QCM, réponses courtes et textes à trous Moodle ainsi que les QCM de page avec un titre « Question 1 » sont pris en charge.');
    return;
  }
  const host = document.createElement('div');
  host.id = 'moodle-ia-extension';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { font:14px/1.5 system-ui,sans-serif; color:#182333; }
    section { background:white; border:1px solid #bbc6d7; border-radius:16px; padding:18px; width:320px; max-width:80vw; box-shadow:0 8px 32px #14243b33; }
    h2 { margin:0 0 6px; font-size:18px; } p { margin:8px 0; }
    button { cursor:pointer; border:0; border-radius:8px; padding:10px; background:#214ab4; color:white; font:inherit; }
    button:disabled { opacity:.6; cursor:wait; } .secondary { background:#eef1f7; color:#182333; margin-left:4px; }
    #details { max-height:230px; overflow:auto; white-space:pre-wrap; } #status { color:#394f6c; }
    label { display:block; margin:12px 0; }
  </style><section aria-label="Assistant IA pour entraînement">
    <h2>Bouton IA · Moodle</h2>
    <p>Les questions de cette page seront envoyées au fournisseur choisi dans les réglages (Groq ou OpenAI). La requête utilise votre quota API.</p>
    <label><input type="checkbox" id="allowed"> Cet entraînement autorise l’IA.</label>
    <button id="answer" disabled>Demander et remplir</button><button id="settings" class="secondary">Réglages</button>
    <p id="status" role="status">Aucune soumission automatique.</p><div id="details"></div>
  </section>`;
  document.documentElement.append(host);
  const button = root.querySelector('#answer');
  const allowed = root.querySelector('#allowed');
  const status = root.querySelector('#status');
  const details = root.querySelector('#details');
  allowed.onchange = () => { button.disabled = !allowed.checked; };
  root.querySelector('#settings').onclick = () => chrome.runtime.sendMessage({ type: 'options' });
  button.onclick = async () => {
    if (!allowed.checked) return;
    button.disabled = true;
    allowed.disabled = true;
    details.textContent = '';
    status.textContent = 'Réflexion en cours…';
    try {
      const questions = MoodleIA.collect(document);
      if (!questions.length) throw new Error('Aucune question prise en charge : QCM, vrai/faux, réponse courte ou texte à trous attendus.');
      const { result, error } = await chrome.runtime.sendMessage({
        type: 'answer', questions: questions.map(({ fields, ...data }) => data)
      });
      if (error) throw new Error(error);
      let filled = 0;
      for (const question of questions) {
        const answers = result.answers.filter(answer => answer?.id === question.id);
        if (answers.length !== 1) continue;
        const answer = answers[0];
        let note = '';
        try { if (MoodleIA.apply(question, answer)) filled++; }
        catch (error) { note = error.message; }
        const paragraph = document.createElement('p');
        paragraph.textContent = `${question.id} : ${note || answer.explanation || 'Sans explication.'}`;
        details.append(paragraph);
      }
      status.textContent = `${filled}/${questions.length} réponse(s) remplie(s). Vérifiez-les avant de valider. Les formats complexes sont ignorés.`;
    } catch (error) {
      status.textContent = error.message || 'Communication avec l’extension interrompue.';
    } finally {
      allowed.disabled = false;
      button.disabled = !allowed.checked;
    }
  };
})();
