import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { chromium } from '@playwright/test';

let directory, server, browser, origin;
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workbench.css"><style>body{margin:16px;--ink:#25342e;--muted:#59675f;--paper:#fffef9;--line:#d4ddd4;--accent:#456755;--soft:#edf2eb;--sans:system-ui}</style><main id="mount"></main><script type="module">
import { mountArtifactWorkbench } from '/workbench.js';
window.calls = { mounts: 0, cleanups: 0, restores: [], retries: 0, cancels: 0 };
window.props = { title: '物资分配', summary: '调整数量，查看剩余物资', html: '<iframe title="分配工具" srcdoc="<p>保留的作品</p>"></iframe><input aria-label="数量" value="3">', busy: false, revisions: [{id:'r1',reason:'初版'},{id:'r2',reason:'按人数分配'}], currentRevision: 'r2', onRestore: id => calls.restores.push(id), onRetry: () => calls.retries++, onCancel: () => calls.cancels++, onContentMount: () => { calls.mounts++; return () => calls.cleanups++; } };
window.workbench = mountArtifactWorkbench(document.getElementById('mount'), window.props);
window.updateWorkbench = patch => { window.props = {...window.props, ...patch}; window.workbench.update(window.props); };
window.ready = true;
</script></html>`;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'artifact-workbench-'));
  await build({ build: { outDir: directory }, logLevel: 'error' });
  server = createServer(async (request, response) => {
    if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(fixture); return; }
    const name = request.url === '/workbench.css' ? 'workbench.css' : 'workbench.js';
    response.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(await readFile(join(directory, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function withPage(run, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(origin);
    await page.waitForFunction(() => window.ready);
    await run(page);
  } finally { await page.close(); }
}

test('workbench module imports in Node without browser globals', async () => {
  const module = await import(pathToFileURL(join(directory, 'workbench.js')).href);
  assert.equal(typeof module.mountArtifactWorkbench, 'function');
});

test('status and header updates retain iframe, input, bindings and collapse identity', async () => withPage(async page => {
  await page.getByRole('textbox', { name: '数量' }).fill('17');
  await page.evaluate(() => { window.oldFrame = document.querySelector('iframe'); window.updateWorkbench({ title: '更新后的物资分配', busy: true, stage: 'checking' }); });
  assert.equal(await page.getByRole('status').textContent(), '正在检查');
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.oldFrame), true);
  assert.equal(await page.getByRole('textbox', { name: '数量' }).inputValue(), '17');
  await page.getByRole('button', { name: '收起作品' }).click();
  assert.equal(await page.getByRole('textbox', { name: '数量' }).isVisible(), false);
  await page.getByRole('button', { name: '展开作品' }).click();
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.oldFrame), true);
  assert.equal(await page.evaluate(() => calls.mounts), 1);
  await page.evaluate(() => window.updateWorkbench({ html: '<p>第二版内容</p>' }));
  assert.deepEqual(await page.evaluate(() => ({ mounts: calls.mounts, cleanups: calls.cleanups })), { mounts: 2, cleanups: 1 });
  await page.evaluate(() => window.workbench.dispose());
  assert.equal(await page.locator('#mount').textContent(), '');
  assert.equal(await page.evaluate(() => calls.cleanups), 2);
}));

test('history exposes current revision and restores selected old revision', async () => withPage(async page => {
  await page.getByRole('button', { name: '版本历史' }).click();
  assert.equal(await page.getByText('当前版本').isVisible(), true);
  await page.getByRole('button', { name: '恢复版本 1' }).click();
  assert.deepEqual(await page.evaluate(() => calls.restores), ['r1']);
  await page.evaluate(() => window.updateWorkbench({ busy: true, stage: 'building' }));
  assert.equal(await page.getByRole('button', { name: '恢复版本 1' }).isDisabled(), true);
}));

test('cancel and error recovery use latest callbacks and text stays escaped', async () => withPage(async page => {
  await page.evaluate(() => window.updateWorkbench({ busy: true, stage: 'generating', onCancel: () => calls.cancels += 10 }));
  await page.getByRole('button', { name: '取消生成' }).click();
  assert.equal(await page.evaluate(() => calls.cancels), 10);
  await page.evaluate(() => window.updateWorkbench({ busy: false, stage: 'failed', error: '<img src=x onerror=alert(1)> 构建失败' }));
  assert.match(await page.getByRole('alert').textContent(), /<img src=x onerror=alert\(1\)> 构建失败/);
  assert.equal(await page.getByRole('alert').locator('img').count(), 0);
  await page.getByRole('button', { name: '重试' }).click();
  assert.equal(await page.evaluate(() => calls.retries), 1);
  assert.equal(await page.locator('iframe').count(), 1);
}));

test('empty surface hides and later work becomes visible without replacing the mount', async () => withPage(async page => {
  await page.evaluate(() => window.updateWorkbench({ title: '', summary: '', html: '', busy: false, stage: undefined, error: undefined }));
  assert.equal(await page.locator('[data-artifact-workbench]').isVisible(), false);
  await page.evaluate(() => window.updateWorkbench({ busy: true, stage: 'queued' }));
  assert.equal(await page.getByRole('status').textContent(), '等待处理');
  assert.equal(await page.locator('[data-artifact-workbench]').isVisible(), true);
}));

test('390px supports keyboard history, long diagnostics and reduced motion without page overflow', async () => withPage(async page => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.updateWorkbench({ title: '很长的作品标题'.repeat(18), error: 'LongDiagnostic'.repeat(60), busy: true, stage: 'repairing' }));
  await page.getByRole('button', { name: '版本历史' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByText('当前版本').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.getByRole('button', { name: '取消生成' }).isVisible(), true);
}, { width: 390, height: 844 }));

test('legacy wrapper headings defer to React controls while nested inspection details remain accessible', async () => withPage(async page => {
  await page.evaluate(() => window.updateWorkbench({ html: '<details class="dynamic-interaction" open><summary>重复作品标题</summary><p>重复说明</p><div data-dynamic-values><details open><summary>查看原始数据</summary><p>可访问的资料</p></details></div></details>' }));
  assert.equal(await page.getByText('重复作品标题').isVisible(), false);
  assert.equal(await page.getByText('重复说明').isVisible(), false);
  assert.equal(await page.getByText('查看原始数据').isVisible(), true);
  assert.equal(await page.getByText('可访问的资料').isVisible(), true);
}));
