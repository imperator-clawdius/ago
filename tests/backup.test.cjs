const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storageKey = 'ago.items.v1';
let server, browser, baseURL;

before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      const content = await fs.readFile(file);
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function item(overrides = {}) {
  return { id: 'plants', name: 'Watered plants', emoji: '🪴', threshold: 604800000,
    last: 1700000000000, history: [1700000000000], ...overrides };
}

async function open(t, initial = [item()], serviceWorkers = 'block') {
  const context = await browser.newContext({ serviceWorkers });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL);
  await page.evaluate(({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)),
    { key: storageKey, initial });
  await page.reload();
  t.after(() => assert.deepEqual(errors, [], 'the app must not throw in the browser'));
  return { page, context };
}

async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function importBackup(page, data) {
  await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)) });
  await page.waitForFunction(() => document.getElementById('importFile').value === '');
}

test('exported v1 backups round-trip, merge by id, and remain undoable', async t => {
  const { page } = await open(t);
  await page.locator('.didit').click();
  const original = await stored(page);
  await page.locator('#menuBtn').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const download = await downloadPromise;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.deepEqual(backup, { app: 'ago', v: 1, items: original });

  const updated = { ...backup.items[0], name: 'Plants from backup' };
  const added = item({ id: 'sheets', name: 'Changed sheets', last: null, history: [] });
  await importBackup(page, { ...backup, items: [updated, added] });
  assert.deepEqual(await stored(page), [updated, added]);
  assert.equal(await page.locator('.card').count(), 2);
  await page.locator('#undoBtn').click();
  assert.deepEqual(await stored(page), original);

  // Legacy raw arrays remain supported, including details and future taps.
  await importBackup(page, [updated]);
  await page.locator('.info').click();
  assert.equal(await page.locator('#histList li').count(), updated.history.length);
  await page.locator('#closeDetBtn').click();
  await page.locator('.didit').click();
  assert.equal((await stored(page))[0].history.length, updated.history.length + 1);
  await page.reload();
  assert.equal(await page.locator('.name').textContent(), updated.name);
});

test('malformed backups cannot overwrite or partially import existing trackers', async t => {
  const { page } = await open(t);
  const original = await stored(page);
  const invalidRecords = [
    item({ history: {} }), item({ id: 123 }), item({ name: { text: 'bad' } }),
    item({ emoji: null }), item({ threshold: -1 }), item({ last: 'yesterday' }),
    item({ history: [1e100] }), null,
  ];
  for (const invalid of invalidRecords) {
    await importBackup(page, { app: 'ago', v: 1, items: [item({ id: 'new' }), invalid] });
    assert.equal(await page.locator('#toastMsg').textContent(), 'That does not look like an Ago backup');
    assert.deepEqual(await stored(page), original, 'reject the entire import before saving');
    assert.equal(await page.locator('.card').count(), 1);
  }
  await page.reload();
  await page.locator('.didit').click();
  assert.equal((await stored(page))[0].history.length, 2);
});

test('imported emoji markup stays literal text after import and reload', async t => {
  const { page } = await open(t, []);
  const emoji = '<img src="missing" onerror="document.body.dataset.importedMarkup=1">';
  await importBackup(page, [item({ emoji })]);
  for (let reload = 0; reload < 2; reload++) {
    assert.equal(await page.locator('.emoji').textContent(), emoji);
    assert.equal(await page.locator('.emoji img').count(), 0);
    assert.equal(await page.evaluate(() => document.body.dataset.importedMarkup), undefined);
    await page.locator('.didit').click();
    await page.reload();
  }
  assert.equal((await stored(page))[0].history.length, 3);
});

test('a failed storage write leaves the current trackers and prior undo intact', async t => {
  const { page } = await open(t);
  const original = await stored(page);
  await page.locator('.didit').click();
  const beforeImport = await stored(page);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    window.restoreStorageWrites = () => { Storage.prototype.setItem = setItem; };
    Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
  });
  await importBackup(page, [item({ name: 'Rejected replacement' })]);
  assert.equal(await page.locator('#toastMsg').textContent(), 'Device storage could not save this backup');
  assert.deepEqual(await stored(page), beforeImport);
  assert.equal(await page.locator('.name').textContent(), original[0].name);

  await page.evaluate(() => window.restoreStorageWrites());
  await page.locator('#undoBtn').click();
  assert.deepEqual(await stored(page), original, 'failed import must preserve the previous undo');
  await page.locator('.didit').click();
  assert.equal((await stored(page))[0].name, original[0].name, 'rejected data must not land on a later save');
  await page.reload();
  assert.equal(await page.locator('.name').textContent(), original[0].name);
});

test('the repaired app remains usable offline after installation', async t => {
  const { page, context } = await open(t, [item()], 'allow');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Navigate after activation so the test does not race first-install takeover.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('.name').textContent(), 'Watered plants');
  await page.locator('.didit').click();
  assert.equal((await stored(page))[0].history.length, 2);
  await importBackup(page, [item({ id: 'sheets', name: 'Changed sheets', last: null, history: [] })]);
  assert.equal(await page.locator('.card').count(), 2);
});
