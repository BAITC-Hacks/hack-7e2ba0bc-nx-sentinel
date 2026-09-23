import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fileURLToPath(
  new URL('../.cache/ms-playwright', import.meta.url),
);
process.env.TMPDIR = fileURLToPath(new URL('../.cache/tmp', import.meta.url));
process.env.XDG_CACHE_HOME = fileURLToPath(new URL('../.cache', import.meta.url));
process.env.XDG_CONFIG_HOME = fileURLToPath(new URL('../.cache/browser-config', import.meta.url));
await mkdir(process.env.TMPDIR, { recursive: true });
const artifacts = fileURLToPath(new URL('../.artifacts', import.meta.url));
await mkdir(artifacts, { recursive: true });
const { chromium } = await import('@playwright/test');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.location().url.endsWith('/missing-source'))
    errors.push(message.text());
});
const base = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const findings = [];
try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Campaign command center', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.getByRole('button', { name: 'Run Agent', exact: true }).isDisabled(),
    true,
  );
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1600],
    [1366, 768],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Overflow at ${width}px`,
    );
    await page.screenshot({ path: `${artifacts}/overview-${width}.png`, fullPage: true });
    if (width === 1920 || width === 390)
      await page.screenshot({
        path: `${artifacts}/review-${width}.jpg`,
        type: 'jpeg',
        quality: 55,
      });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const label of ['Overview', 'Agent', 'Audience', 'Exploration', 'Campaigns', 'Analytics']) {
    await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
    await page.waitForTimeout(80);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    findings.push({
      route: label,
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    });
    await writeFile(`${artifacts}/accessibility.json`, JSON.stringify(findings, null, 2));
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Overflow on ${label}`,
    );
  }
  await page.getByRole('button', { name: 'Connect source', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect the evidence.' });
  await dialog.waitFor();
  await page.getByLabel('Data source URL').fill(`${base}/missing-source`);
  await dialog.getByRole('button', { name: 'Connect source', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.ok((await dialog.getByRole('alert').innerText()).length > 0);
  const dialogAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  findings.push({
    route: 'Source dialog',
    violations: dialogAxe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  // Transport-contract check: an empty state response, never fictional business data.
  let startRequests = 0;
  await page.route('**/__checks/snapshot', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schema_version: 1, state: 'DATA_READY' }),
    }),
  );
  await page.route('**/__checks/start', (route) => {
    startRequests++;
    return route.fulfill({ status: 202, body: '' });
  });
  await page.getByRole('button', { name: 'Connect source', exact: true }).first().click();
  await page.getByLabel('Data source URL').fill(`${base}/__checks/snapshot`);
  await page.getByLabel('Agent start URL').fill(`${base}/__checks/start`);
  await page
    .getByRole('dialog', { name: 'Connect the evidence.' })
    .getByRole('button', { name: 'Connect source', exact: true })
    .click();
  await page.getByRole('dialog', { name: 'Connect the evidence.' }).waitFor({ state: 'detached' });
  assert.equal(
    await page.getByRole('button', { name: 'Run Agent', exact: true }).isDisabled(),
    false,
  );
  await page.getByRole('button', { name: 'Run Agent', exact: true }).click();
  await page.getByRole('button', { name: 'Awaiting status', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Awaiting status', exact: true }).isDisabled(),
    true,
  );
  await page.waitForTimeout(3200);
  assert.equal(startRequests, 1, 'An accepted but unconfirmed start must not be submitted twice');
  await page.getByRole('navigation').getByRole('link', { name: 'Campaigns', exact: true }).click();
  await page.getByLabel('Import actual agent results').setInputFiles({
    name: 'empty-submission.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('target_tariff,channel\n'),
  });
  await page.getByRole('heading', { name: 'No campaigns were selected' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Export CSV' }).isDisabled(), true);
  await page.getByLabel('Import actual agent results').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await page.getByRole('alert').waitFor();
  assert.ok(await page.getByText('Last successfully loaded data remains available.').isVisible());
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  // Empty state transitions exercise the UI without generating business entities or outcomes.
  for (const state of [
    'DATA_READY',
    'AGENT_RUNNING',
    'PILOT_RUNNING',
    'OPTIMIZING',
    'COMPLETED',
    'FAILED',
  ]) {
    await page.getByLabel('Import actual agent results').setInputFiles({
      name: 'state-only.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schema_version: 1, state })),
    });
    await page.waitForTimeout(80);
    assert.equal(
      await page.getByRole('button', { name: 'Run Agent', exact: true }).isDisabled(),
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Audience', exact: true }).click();
  await page.getByRole('heading', { name: 'Audience intelligence', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open decision intelligence' }).click();
  await page.getByRole('dialog', { name: 'Decision intelligence', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('dialog', { name: 'Decision intelligence', exact: true }).isVisible(),
    false,
  );
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(`${artifacts}/accessibility.json`, JSON.stringify(findings, null, 2));
  const failures = findings.flatMap((f) => f.violations.map((v) => ({ route: f.route, ...v })));
  console.log(
    JSON.stringify(
      {
        runtimeErrors: errors,
        accessibilityViolations: failures,
        screenshots: [1920, 2560, 1366, 1024, 390],
      },
      null,
      2,
    ),
  );
  assert.equal(
    failures.length,
    0,
    'Accessibility violations found; see .artifacts/accessibility.json',
  );
  console.log(
    'PASS: routes, layouts, empty states, invalid source, import errors, preserved data, mobile navigation, dialogs and agent state rendering.',
  );
} finally {
  await browser.close();
}
