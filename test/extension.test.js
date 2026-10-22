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
