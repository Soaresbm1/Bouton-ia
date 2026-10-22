const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const fixture = `<form id="quiz">
<div class="que" id="q1"><div class="qtext">Combien font 2 + 2 ?</div><div class="answer">
<label><input type="radio" name="q1" value="a">3</label><label><input type="radio" name="q1" value="b">4</label></div></div>
<div class="que" id="q2"><div class="qtext">Nombres pairs</div><div class="answer">
<label><input type="checkbox" checked>3</label><label><input type="checkbox">4</label><label><input type="checkbox">6</label></div></div>
<div class="que" id="q3"><div class="qtext">Capitale de la France</div><div class="answer"><input type="text"></div></div>
<div class="que" id="q4"><div class="qtext">Appariement</div><div class="answer"><select><option>A</option></select></div></div>
<div class="que" id="q5"><div class="qtext">Lecture seule</div><div class="answer"><input type="text" readonly></div></div>
<button type="submit">Terminer</button></form>`;
function page() {
  const dom = new JSDOM(fixture, { runScripts: 'outside-only', url: 'https://moodle.example/mod/quiz/attempt.php' });
  dom.window.eval(source('questions.js'));
  return dom.window;
}
test('extracts supported editable questions only', () => {
  const window = page();
  const questions = window.MoodleIA.collect(window.document);
  assert.deepEqual(Array.from(questions, q => q.type), ['single', 'multiple', 'text']);
  assert.equal(questions[0].choices[1].label, '4');
  assert.equal(questions[0].prompt, 'Combien font 2 + 2 ?');
});
test('fills radio, multiple and text answers, emits events and never submits', () => {
  const w = page();
  let submissions = 0, changes = 0;
  w.document.querySelector('form').onsubmit = e => { e.preventDefault(); submissions++; };
  w.document.addEventListener('change', () => changes++);
  const q = w.MoodleIA.collect(w.document);
  assert.equal(w.MoodleIA.apply(q[0], { id: 'q1', choices: ['1'] }), true);
  assert.equal(w.MoodleIA.apply(q[1], { id: 'q2', choices: ['1', '2'] }), true);
  assert.equal(w.MoodleIA.apply(q[2], { id: 'q3', text: 'Paris' }), true);
  assert.equal(q[0].fields[1].checked, true);
  assert.deepEqual(Array.from(q[1].fields, f => f.checked), [false, true, true]);
  assert.equal(q[2].fields[0].value, 'Paris');
  assert.ok(changes >= 5);
  assert.equal(submissions, 0);
});
test('invalid and empty AI choices do not change existing answers', () => {
  const w = page();
  const [q] = w.MoodleIA.collect(w.document);
  q.fields[0].checked = true;
  for (const choices of [['9'], ['0', '1'], ['0', '0']]) {
    assert.throws(() => w.MoodleIA.apply(q, { id: q.id, choices }), /invalide/);
    assert.equal(q.fields[0].checked, true);
  }
  assert.equal(w.MoodleIA.apply(q, { id: q.id, choices: [] }), false);
});
test('panel sends question data only and fills a simulated response without submitting', async () => {
  const w = page();
  const roots = [];
  const attachShadow = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) {
    const root = attachShadow.call(this, options); roots.push(root); return root;
  };
  let request, submissions = 0;
  w.document.querySelector('form').onsubmit = e => { e.preventDefault(); submissions++; };
  w.chrome = { runtime: { sendMessage: async message => {
    request = message;
    return { result: { answers: [{ id: 'q1', choices: ['1'], explanation: '<b>4</b>' }] } };
  } } };
  w.eval(source('content.js'));
  w.eval(source('content.js'));
  assert.equal(roots.length, 1);
  const root = roots[0];
  assert.equal(root.querySelector('#answer').disabled, true);
  const checkbox = root.querySelector('#allowed');
  checkbox.checked = true; checkbox.dispatchEvent(new w.Event('change'));
  root.querySelector('#answer').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(request.type, 'answer');
  assert.equal(request.questions[0].fields, undefined);
  assert.equal(w.document.querySelectorAll('[name=q1]')[1].checked, true);
  assert.match(root.querySelector('#status').textContent, /1\/3/);
  assert.equal(root.querySelector('#details b'), null);
  assert.match(root.querySelector('#details').textContent, /<b>4<\/b>/);
  assert.equal(submissions, 0);
});
function background(apiKey, fetch, settings = {}, extraKeys = {}) {
  let listener;
  const chrome = {
    runtime: { id: 'extension-id', onMessage: { addListener: fn => { listener = fn; } } },
    action: { onClicked: { addListener() {} } },
    storage: { session: { get: async () => ({ apiKey, ...extraKeys }) }, local: { get: async () => settings } }
  };
  const context = vm.createContext({ chrome, fetch, AbortController, setTimeout, clearTimeout });
  context.importScripts = name => vm.runInContext(source(name), context);
  vm.runInContext(source('background.js'), context);
  return () => new Promise(resolve => listener({ type: 'answer', questions: [{ id: 'q1' }] }, { id: chrome.runtime.id }, resolve));
}
test('missing API key reports actionable error without requesting API', async () => {
  const run = background(undefined, () => { throw new Error('Unexpected fetch'); });
  assert.match((await run()).error, /clé API/);
});
test('API success, rate limits and invalid payloads are handled', async () => {
  const run = background('test-only', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'gpt-4.1-mini');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"answers":[]}' } }] }) };
  });
  assert.equal((await run()).result.answers.length, 0);
  const limited = background('test-only', async () => ({ ok: false, status: 429 }));
  assert.match((await limited()).error, /Quota/);
  const malformed = background('test-only', async () => ({ ok: true, json: async () => ({}) }));
  assert.match((await malformed()).error, /invalide/);
});

test('Groq uses its endpoint, model and its own key, never the OpenAI key', async () => {
  const run = background('openai-test-only', async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer groq-test-only');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'llama-3.3-70b-versatile');
    assert.equal(body.response_format.type, 'json_object');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"answers":[]}' } }] }) };
  }, { provider: 'groq', model: 'old-openai-model' }, { apiKey_groq: 'groq-test-only' });
  assert.equal((await run()).result.answers.length, 0);
  const missing = background('openai-test-only', () => { throw new Error('Wrong key must never be sent'); }, { provider: 'groq' });
  assert.match((await missing()).error, /clé API Groq/);
});

test('provider options save Groq key in session only and preserve OpenAI settings', async () => {
  const dom = new JSDOM(source('options.html'), { runScripts: 'outside-only' });
  const w = dom.window;
  const local = { model: 'existing-openai-model' };
  const session = { apiKey: 'openai-test-only' };
  const storage = data => ({
    get: async () => ({ ...data }),
    set: async update => Object.assign(data, update),
    remove: async names => { for (const name of [].concat(names)) delete data[name]; }
  });
  w.chrome = { storage: { local: storage(local), session: storage(session) } };
  w.eval(source('providers.js'));
  w.eval(source('options.js'));
  await new Promise(resolve => setImmediate(resolve));
  const provider = w.document.querySelector('#provider');
  assert.equal(provider.value, 'openai');
  assert.equal(w.document.querySelector('#model').value, 'existing-openai-model');
  provider.value = 'groq';
  provider.dispatchEvent(new w.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.document.querySelector('#model').value, 'llama-3.3-70b-versatile');
  w.document.querySelector('#key').value = 'groq-test-only';
  w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(local.provider, 'groq');
  assert.equal(local.model, 'existing-openai-model');
  assert.equal(local.model_groq, 'llama-3.3-70b-versatile');
  assert.equal(session.apiKey_groq, 'groq-test-only');
  assert.equal(JSON.stringify(local).includes('test-only'), false);
  w.document.querySelector('#clear').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.apiKey_groq, undefined);
  assert.equal(session.apiKey, 'openai-test-only');
});

const drillFixture = `<header><input type="text" value="Recherche privée"></header>
<main id="region-main"><h1>Drill des objectifs</h1>
<h2>Question 1</h2><p id="prompt">Synonyme de programmation <strong>fonctionnelle</strong> ?</p>
<p><input type="checkbox">Programmation en F#, Haskell, Clojure ou Ocaml</p>
<p><input type="checkbox">Impérative</p>
<p><input type="checkbox">Déclarative</p>
<p>Temps restant : <span id="time">4</span></p><button id="correct">Corriger</button>
<footer><input type="text" value="Champ hors exercice"></footer></main>`;
function drill(html = drillFixture) {
  const { window } = new JSDOM(html, { runScripts: 'outside-only', url: 'https://learn.s2.rpn.ch/mod/page/view.php?id=403102' });
  window.eval(source('questions.js'));
  return window;
}
test('custom Moodle page drill extracts heading, prompt and unlabelled checkbox choices', () => {
  const w = drill();
  const [q] = w.MoodleIA.collect(w.document);
  assert.equal(q.prompt, 'Synonyme de programmation fonctionnelle ?');
  assert.equal(q.type, 'multiple');
  assert.deepEqual(Array.from(q.choices, c => c.label), ['Programmation en F#, Haskell, Clojure ou Ocaml', 'Impérative', 'Déclarative']);
  let corrections = 0;
  w.document.querySelector('#correct').onclick = () => corrections++;
  w.document.querySelector('#time').textContent = '3';
  w.MoodleIA.apply(q, { id: q.id, choices: ['0', '2'] });
  assert.deepEqual(Array.from(q.fields, f => f.checked), [true, false, true]);
  assert.equal(corrections, 0);
  assert.equal(w.document.querySelector('header input').value, 'Recherche privée');
});
test('custom drill bounds each question and also handles inline choices', () => {
  const w = drill(`<main><h2>Question 1</h2><p>Deux plus deux ?</p>
    <input type="radio" name="one">3<br><input type="radio" name="one">4<br>
    <h2>Question 2</h2><p>Capitale ?</p><label><input type="radio" name="two">Paris</label>
    <label><input type="radio" name="two">Berne</label><button>Corriger</button></main>`);
  const qs = w.MoodleIA.collect(w.document);
  assert.equal(qs.length, 2);
  assert.deepEqual(Array.from(qs[0].choices, c => c.label), ['3', '4']);
  assert.equal(qs[1].prompt, 'Capitale ?');
  assert.equal(qs[1].fields.length, 2);
});
test('changed question text or replaced inputs prevents stale AI answers from filling', () => {
  const w = drill();
  const [q] = w.MoodleIA.collect(w.document);
  w.document.querySelector('#prompt').textContent = 'Une autre question';
  assert.throws(() => w.MoodleIA.apply(q, { id: q.id, choices: ['0'] }), /question a changé/);
  assert.equal(q.fields.some(f => f.checked), false);
  const [next] = w.MoodleIA.collect(w.document);
  next.fields[0].replaceWith(next.fields[0].cloneNode());
  assert.throws(() => w.MoodleIA.apply(next, { id: next.id, choices: ['0'] }), /question a changé/);
  assert.equal(w.document.querySelector('main input').checked, false);
});
test('panel opens on custom drill and reports question changes during an API request', async () => {
  const w = drill();
  let root, resolve;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) { root = attach.call(this, options); return root; };
  w.chrome = { runtime: { sendMessage: () => new Promise(done => { resolve = done; }) } };
  w.eval(source('content.js'));
  assert.ok(root);
  const allowed = root.querySelector('#allowed');
  allowed.checked = true; allowed.dispatchEvent(new w.Event('change'));
  root.querySelector('#answer').click();
  const [q] = w.MoodleIA.collect(w.document);
  w.document.querySelector('#prompt').textContent = 'Question suivante';
  resolve({ result: { answers: [{ id: q.id, choices: ['0'] }] } });
  await new Promise(done => setImmediate(done));
  assert.match(root.querySelector('#status').textContent, /0\/1/);
  assert.match(root.querySelector('#details').textContent, /question a changé/);
  assert.equal(q.fields.some(field => field.checked), false);
});

const clozeFixture = `<form><div class="que" id="cloze1"><div class="qtext">
<p>Applications de la programmation fonctionnelle :</p><ul>
<li>Applications t<span class="answer"><input type="text" value="ancienne réponse"></span> et m<input type="text"></li>
<li>Domaine spécifique en 2 lettres <input type="text"></li>
<li>Compilateurs et <input type="text"></li><li>A<input type="text"></li></ul>
</div></div><button type="submit">Page suivante</button></form>`;
function cloze() {
  const { window } = new JSDOM(clozeFixture, { runScripts: 'outside-only', url: 'https://moodle.example/mod/quiz/attempt.php' });
  window.eval(source('questions.js'));
  return window;
}
test('Moodle cloze extracts all inline fields with numbered markers, not saved answers', () => {
  const w = cloze();
  const [q] = w.MoodleIA.collect(w.document);
  assert.equal(q.type, 'blanks');
  assert.equal(q.fields.length, 5);
  assert.match(q.prompt, /t\[champ 0\] et m\[champ 1\]/);
  assert.match(q.prompt, /A\[champ 4\]/);
  assert.equal(q.prompt.includes('ancienne réponse'), false);
  assert.deepEqual(Array.from(q.blanks, blank => blank.id), ['0', '1', '2', '3', '4']);
});
test('cloze matches returned values by ID even out of order and never submits', () => {
  const w = cloze();
  const [q] = w.MoodleIA.collect(w.document);
  let submissions = 0, inputs = 0;
  w.document.querySelector('form').onsubmit = event => { event.preventDefault(); submissions++; };
  w.document.addEventListener('input', () => inputs++);
  const values = ['texte-a', 'texte-b', 'XX', 'texte-c', 'texte-d'].map((text, i) => ({ id: String(i), text })).reverse();
  assert.equal(w.MoodleIA.apply(q, { id: q.id, values }), true);
  assert.deepEqual(Array.from(q.fields, field => field.value), ['texte-a', 'texte-b', 'XX', 'texte-c', 'texte-d']);
  assert.equal(inputs, 5);
  assert.equal(submissions, 0);
});
test('cloze rejects missing, duplicate and invalid fields without partial changes', () => {
  const w = cloze();
  const [q] = w.MoodleIA.collect(w.document);
  const values = q.fields.map((field, i) => ({ id: String(i), text: `test ${i}` }));
  for (const invalid of [values.slice(1), [...values.slice(1), values[1]], [...values.slice(1), { id: '99', text: 'test' }]]) {
    assert.throws(() => w.MoodleIA.apply(q, { id: q.id, values: invalid }), /invalides ou incomplètes/);
    assert.equal(q.fields[0].value, 'ancienne réponse');
    assert.equal(q.fields[1].value, '');
  }
  assert.equal(w.MoodleIA.apply(q, { id: q.id, values: [] }), false);
});

// Moodle's multianswer renderer returns inline content directly inside the
// engine's .formulation wrapper, without a .qtext or .answer container.
// Reference: moodle/moodle MOODLE_405_STABLE question/type/multianswer/renderer.php
// and question/engine/renderer.php.
function nativeCloze() {
  const html = `<div class="que multianswer" id="question-123-1"><div class="info">Question 1</div>
  <div class="content"><div class="formulation clearfix"><h4 class="accesshide">Texte de la question</h4>
  <input type="hidden" name="q123:1_:sequencecheck" value="1">
  <p>Applications de la programmation fonctionnelle :</p><ul>
  <li>Applications t<span class="subquestion"><label class="subq accesshide" for="a">Réponse 1</label><input type="text" id="a" name="q123:1_sub1_answer" class="form-control d-inline mb-1"></span>
  et m<span class="subquestion"><label class="subq accesshide" for="b">Réponse 2</label><input type="text" id="b" name="q123:1_sub2_answer"></span></li>
  </ul></div><div class="outcome"><div class="specificfeedback">Feedback privé à exclure</div></div></div></div>`;
  const { window } = new JSDOM(html, { runScripts: 'outside-only', url: 'https://moodle.example/mod/quiz/attempt.php' });
  window.eval(source('questions.js'));
  return window;
}
test('native Moodle multianswer without qtext is detected and excludes hidden fields and accessibility labels', () => {
  const w = nativeCloze();
  const questions = w.MoodleIA.collect(w.document);
  assert.equal(questions.length, 1);
  const [q] = questions;
  assert.equal(q.type, 'blanks');
  assert.equal(q.fields.length, 2);
  assert.match(q.prompt, /t\[champ 0\]\s+et m\[champ 1\]/);
  assert.equal(q.prompt.includes('Réponse'), false);
  assert.equal(q.prompt.includes('Feedback'), false);
  assert.equal(q.prompt.includes('Texte de la question'), false);
});
test('panel detects and fills native multianswer formulation with a simulated AI response', async () => {
  const w = nativeCloze();
  let root;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) { root = attach.call(this, options); return root; };
  w.alert = () => assert.fail('Native Moodle cloze must be detected');
  w.chrome = { runtime: { sendMessage: async message => ({ result: { answers: [{
    id: message.questions[0].id,
    values: [{ id: '1', text: 'test-b' }, { id: '0', text: 'test-a' }]
  }] } }) } };
  w.eval(source('content.js'));
  const allowed = root.querySelector('#allowed');
  allowed.checked = true; allowed.dispatchEvent(new w.Event('change'));
  root.querySelector('#answer').click();
  await new Promise(done => setImmediate(done));
  assert.equal(w.document.querySelector('#a').value, 'test-a');
  assert.equal(w.document.querySelector('#b').value, 'test-b');
  assert.equal(w.document.querySelector('input[type=hidden]').value, '1');
  assert.match(root.querySelector('#status').textContent, /1\/1/);
});

async function modelOptions(fetch, session = { apiKey_groq: 'groq-test-only' }) {
  const { window: w } = new JSDOM(source('options.html'), { runScripts: 'outside-only' });
  const local = { provider: 'groq', model_groq: 'retired-model' };
  const storage = data => ({ get: async () => ({ ...data }), set: async update => Object.assign(data, update) });
  w.chrome = { storage: { local: storage(local), session: storage(session) } };
  w.fetch = fetch;
  w.eval(source('providers.js'));
  w.eval(source('options.js'));
  await new Promise(done => setImmediate(done));
  return { w, local, load: () => w.document.querySelector('#load-models').onclick() };
}
test('loads actual Groq model IDs with the correct key and can save an available replacement', async () => {
  const { w, local, load } = await modelOptions(async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer groq-test-only');
    return { ok: true, json: async () => ({ data: [
      { id: 'whisper-large-v3' }, { id: 'llama-3.1-8b-instant', active: true },
      { id: 'retired-model', active: false }, { id: 'future-conversation-model' }
    ] }) };
  });
  await load();
  assert.equal(w.document.querySelector('#model').value, 'llama-3.1-8b-instant');
  assert.equal(local.model_groq, 'retired-model');
  const select = w.document.querySelector('#available-models');
  assert.deepEqual(Array.from(select.options, option => option.value), ['', 'future-conversation-model', 'llama-3.1-8b-instant']);
  select.value = 'future-conversation-model'; select.dispatchEvent(new w.Event('change'));
  w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise(done => setImmediate(done));
  assert.equal(local.model_groq, 'future-conversation-model');
  assert.equal(JSON.stringify(local).includes('test-only'), false);
});
test('model loading handles rejected or missing keys without sending an OpenAI key to Groq', async () => {
  const denied = await modelOptions(async () => ({ ok: false, status: 401 }));
  await denied.load();
  assert.match(denied.w.document.querySelector('#status').textContent, /Clé refusée/);
  assert.equal(denied.w.document.querySelector('#load-models').disabled, false);
  const missing = await modelOptions(() => assert.fail('Must not call Groq with OpenAI key'), { apiKey: 'openai-test-only' });
  await missing.load();
  assert.match(missing.w.document.querySelector('#status').textContent, /Saisissez votre clé Groq/);
});
