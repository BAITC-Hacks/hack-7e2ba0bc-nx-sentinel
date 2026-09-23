// Integration fixtures are test data and are isolated in a fresh backend session.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fileURLToPath(
  new URL('../.cache/ms-playwright', import.meta.url),
);
process.env.TMPDIR = fileURLToPath(new URL('../.cache/tmp', import.meta.url));
process.env.XDG_CACHE_HOME = fileURLToPath(new URL('../.cache', import.meta.url));
process.env.XDG_CONFIG_HOME = fileURLToPath(new URL('../.cache/browser-config', import.meta.url));
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('422')) errors.push(message.text());
  });
  const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
  await page.goto(base);
  await page.locator('.source-trigger').click();
  assert.equal(await page.getByLabel('Data source URL').inputValue(), '/api/workspace');
  const dialog = page.getByRole('dialog', { name: 'Connect the evidence.' });
  await dialog.getByRole('button', { name: 'Connect source', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.locator('.source-trigger').click();
  const uploadResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/datasets'),
  );
  await page.getByLabel('Upload audience dataset').setInputFiles({
    name: 'unit-api-check.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,current_tariff,arpu\nunit-browser-fixture,unit-fixture-tariff,123.5\n'),
  });
  const response = await uploadResponse;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.audience_total, 1);
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('navigation').getByRole('link', { name: 'Audience', exact: true }).click();
  await page.getByText('unit-browser-fixture', { exact: true }).waitFor();
  if (!result.capabilities.run_agent)
    assert.equal(
      await page.getByRole('button', { name: 'Run Agent', exact: true }).isDisabled(),
      true,
    );
  await page.locator('.source-trigger').click();
  const invalidResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/datasets'),
  );
  await page.getByLabel('Upload audience dataset').setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,current_tariff,arpu\n'),
  });
  assert.equal((await invalidResponse).status(), 422);
  await dialog.getByRole('alert').waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('unit-browser-fixture', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const other = await browser.newContext();
  const blank = await other.request.get(`${base}/api/workspace`);
  assert.equal((await blank.json()).state, 'INITIAL');
  await other.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real HTTP API, session cookie, upload -> Audience, invalid upload preserves data, capability handling, session isolation, no browser runtime errors. Fixtures are test data, not official case results.',
  );
} finally {
  await browser.close();
}
