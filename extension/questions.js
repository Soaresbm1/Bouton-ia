(() => {
  const clean = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  function collect(doc) {
    return [...doc.querySelectorAll('.que')].flatMap((container, index) => {
      const prompt = container.querySelector('.qtext');
      const area = container.querySelector('.answer');
      if (!prompt || !area) return [];
      const fields = [...area.querySelectorAll('input:not([type=hidden]), textarea, select')]
        .filter(field => !field.disabled && !field.readOnly);
      if (!fields.length) return [];
      let type;
      if (fields.every(field => field.type === 'radio')) type = 'single';
      else if (fields.every(field => field.type === 'checkbox')) type = 'multiple';
      else if (fields.length === 1 && ['text', 'number'].includes(fields[0].type)) type = 'text';
      else return [];
      const choices = type === 'text' ? [] : fields.map((field, i) => {
        const label = field.labels?.[0] || field.closest('label') || field.parentElement;
        return { id: String(i), label: clean(label) };
      });
      return [{ id: container.id || `question-${index}`, prompt: clean(prompt),
        images: [...prompt.querySelectorAll('img')].map(img => img.alt || 'Image sans description'),
        type, choices, fields }];
    });
  }
  function apply(question, answer) {
    if (!answer || answer.id !== question.id) throw new Error('Question incorrecte.');
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
      const desired = ids.includes(String(i));
      if (field.checked !== desired) {
        if (desired || question.type === 'multiple') field.click();
      }
    });
    return true;
  }
  globalThis.MoodleIA = { collect, apply };
})();
