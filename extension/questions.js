(() => {
  const clean = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const editable = field => !field.disabled && !field.readOnly &&
    !field.closest('[hidden], [aria-hidden="true"]');
  function choiceLabel(field) {
    const label = field.labels?.[0] || field.closest('label');
    if (label) return clean(label);
    let text = '';
    for (let node = field.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && (node.matches('input, br, button') || node.querySelector('input'))) break;
      text += node.textContent || '';
    }
    return text.replace(/\s+/g, ' ').trim() || clean(field.parentElement);
  }
  function build(id, prompt, fields) {
    if (!fields.length) return [];
    let type;
    if (fields.every(field => field.type === 'radio')) type = 'single';
    else if (fields.every(field => field.type === 'checkbox')) type = 'multiple';
    else if (fields.every(field => ['text', 'number'].includes(field.type))) type = fields.length === 1 ? 'text' : 'blanks';
    else return [];
    if (!clean(prompt)) return [];
    const choices = ['text', 'blanks'].includes(type) ? [] : fields.map((field, i) => ({ id: String(i), label: choiceLabel(field) }));
    if (choices.some(choice => !choice.label)) return [];
    const markedPrompt = prompt.cloneNode(true);
    const originals = [...prompt.querySelectorAll('input,textarea,select')];
    [...markedPrompt.querySelectorAll('input,textarea,select')].forEach((node, i) => {
      const index = fields.indexOf(originals[i]);
      node.replaceWith(index >= 0 ? `[champ ${index}]` : '');
    });
    markedPrompt.querySelectorAll('script,style,.accesshide,.sr-only,.visually-hidden,.feedback,.specificfeedback,.validationerror').forEach(node => node.remove());
    return [{ id, prompt: clean(markedPrompt),
      images: [...prompt.querySelectorAll('img')].map(img => img.alt || 'Image sans description'),
      type, choices, ...(type === 'blanks' ? { blanks: fields.map((field, i) => ({ id: String(i) })) } : {}), fields }];
  }
  function collectDrill(doc) {
    if (!/^\/mod\/page\/view\.php$/.test(doc.location.pathname)) return [];
    const main = doc.querySelector('#region-main') || doc.querySelector('main');
    if (!main) return [];
    const headings = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter(heading => /^question\s+\d+\s*[:.)]?$/i.test(clean(heading)));
    return headings.flatMap((heading, index) => {
      const range = doc.createRange();
      range.setStartAfter(heading);
      if (headings[index + 1]) range.setEndBefore(headings[index + 1]);
      else range.setEnd(main, main.childNodes.length);
      // Stop at correction/navigation controls so unrelated page fields stay excluded.
      const boundary = [...main.querySelectorAll('button,input[type=submit],input[type=button]')]
        .find(node => range.intersectsNode(node));
      if (boundary) range.setEndBefore(boundary);
      const fields = [...main.querySelectorAll('input:not([type=hidden]),textarea,select')]
        .filter(field => range.intersectsNode(field) && editable(field));
      if (!fields.length) return [];
      const promptRange = doc.createRange();
      promptRange.setStartAfter(heading);
      promptRange.setEndBefore(fields[0].closest('label') || fields[0]);
      const prompt = promptRange.cloneContents();
      prompt.querySelectorAll('script,style,button,input,select,textarea').forEach(node => node.remove());
      return build(`drill-${index}-${clean(heading)}`, prompt, fields);
    });
  }
  function collect(doc) {
    const standard = [...doc.querySelectorAll('.que')].flatMap((container, index) => {
      const prompt = container.querySelector('.qtext') || container.querySelector('.formulation');
      const area = prompt?.querySelector('input:not([type=hidden]),textarea,select') ? prompt : container.querySelector('.answer');
      if (!prompt || !area) return [];
      const fields = [...area.querySelectorAll('input:not([type=hidden]), textarea, select')]
        .filter(editable);
      return build(container.id || `question-${index}`, prompt, fields);
    });
    return standard.length ? standard : collectDrill(doc);
  }
  const signature = ({ fields, ...data }) => JSON.stringify(data);
  function checkCurrent(question) {
    const doc = question.fields[0]?.ownerDocument;
    const current = doc && collect(doc).find(item => item.id === question.id);
    if (!current || signature(current) !== signature(question) ||
        current.fields.some((field, i) => field !== question.fields[i])) {
      throw new Error('La question a changé pendant la requête IA. Relancez pour la question affichée.');
    }
  }
  function apply(question, answer) {
    if (!answer || answer.id !== question.id) throw new Error('Question incorrecte.');
    checkCurrent(question);
    if (question.type === 'blanks') {
      const values = answer.values;
      if (!Array.isArray(values) || !values.length) return false;
      if (values.length !== question.fields.length || new Set(values.map(value => value?.id)).size !== values.length ||
          values.some(value => !question.blanks.some(blank => blank.id === value?.id) || typeof value?.text !== 'string' || !value.text.trim())) {
        throw new Error('Réponses des champs invalides ou incomplètes. Question laissée intacte.');
      }
      const ordered = question.blanks.map(blank => values.find(value => value.id === blank.id).text);
      if (question.fields.some((field, i) => field.disabled || field.readOnly || !field.isConnected ||
          (field.type === 'number' && !Number.isFinite(Number(ordered[i]))))) return false;
      question.fields.forEach((field, i) => {
        checkCurrent(question);
        field.value = ordered[i];
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return true;
    }
    if (question.type === 'text') {
      if (typeof answer.text !== 'string' || !answer.text.trim()) return false;
      const field = question.fields[0];
      if (field.disabled || field.readOnly || !field.isConnected) return false;
      if (field.type === 'number' && !Number.isFinite(Number(answer.text))) return false;
      field.value = answer.text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const ids = answer.choices;
    if (!Array.isArray(ids) || !ids.length) return false;
    if (new Set(ids).size !== ids.length || (question.type === 'single' && ids.length !== 1) ||
        ids.some(id => !question.choices.some(choice => choice.id === id))) {
      throw new Error('Choix IA invalide. Question laissée intacte.');
    }
    if (question.fields.some(field => field.disabled || !field.isConnected)) return false;
    question.fields.forEach((field, i) => {
      checkCurrent(question);
      const desired = ids.includes(String(i));
      if (field.checked !== desired) {
        if (desired || question.type === 'multiple') field.click();
      }
    });
    return true;
  }
  globalThis.MoodleIA = { collect, apply };
})();
