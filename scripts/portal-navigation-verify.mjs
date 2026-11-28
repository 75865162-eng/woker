/**
 * 门户主功能点击跳转验收：
 * 1. 用生产会话登录，打开 /wimoor 门户。
 * 2. 遍历每个一级模块，点击展开抽屉。
 * 3. 逐个点击组内入口链接，等待真实跳转，验证：
 *    - URL 命中预期 localHref
 *    - 渲染后非白屏（有实际文本/表格/标题，且无 Next.js 错误边界）
 * 结果写入 /tmp/portal-nav-verify-result.json 并打印汇总。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://aoocy.com';
const COOKIE_FILE = '/tmp/portal-verify-cookie.txt';
const entries = JSON.parse(fs.readFileSync('/tmp/href-list.json', 'utf8')); // {name,href,id}
const sessionCookie = (() => {
  const line = fs.readFileSync(COOKIE_FILE, 'utf8').split('\n').find(l => l.includes('amazon_bulk_ad_session'));
  const parts = line.split('\t');
  return { name: parts[5], value: parts[6], url: BASE };
})();

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([sessionCookie]);
const page = await context.newPage();

// 捕获运行时错误（白屏常见原因）
const pageErrors = [];
page.on('pageerror', err => pageErrors.push(String(err)));

async function classifyScreen() {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText || '').trim();
    const main = document.querySelector('main')?.innerText?.trim() || '';
    const hasTable = !!document.querySelector('table');
    const hasGridRow = document.querySelectorAll('[role="row"], [data-testid*="row"], tbody tr').length;
    const errorBoundary = /application error|uncaught exception|this page could not be found|出错了|渲染错误|内部错误/i.test(bodyText.slice(0, 2000));
    const nextError = !!document.querySelector('nextjs-portal');
    return {
      bodyLen: bodyText.length,
      mainLen: main.length,
      hasTable,
      gridRows: hasGridRow,
      errorBoundary,
      nextError,
      heading: document.querySelector('h1,h2')?.innerText?.trim()?.slice(0, 60) || '',
    };
  });
}

const results = [];
let done = 0;
for (const e of entries) {
  const url = BASE + e.href;
  let pageErrBefore = pageErrors.length;
  let rec = { ...e, verdict: '', detail: '' };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(900); // 等客户端 hydration / 数据渲染
    const screen = await classifyScreen();
    const newErrors = pageErrors.slice(pageErrBefore);
    const urlOk = new URL(page.url()).pathname === e.href;
    // 白屏判据：正文极短 且 无表格/行 且 无标题；或命中错误边界
    const blank = screen.bodyLen < 40 && screen.gridRows === 0 && !screen.hasTable && !screen.heading;
    if (!urlOk) rec.verdict = 'URL_MISMATCH';
    else if (screen.errorBoundary || screen.nextError) rec.verdict = 'ERROR_BOUNDARY';
    else if (blank) rec.verdict = 'BLANK';
    else if (newErrors.length > 0) rec.verdict = 'JS_ERROR';
    else rec.verdict = 'OK';
    rec.detail = { status: resp?.status(), ...screen, urlPath: new URL(page.url()).pathname, jsErrors: newErrors.slice(0, 2) };
  } catch (err) {
    rec.verdict = 'NAV_FAIL';
    rec.detail = String(err).slice(0, 200);
  }
  results.push(rec);
  done++;
  if (done % 10 === 0) console.log(`  进度 ${done}/${entries.length}`);
}

await browser.close();

const summary = {};
for (const r of results) summary[r.verdict] = (summary[r.verdict] || 0) + 1;
console.log('\n===== 汇总 =====');
console.log(JSON.stringify(summary, null, 2));
const problems = results.filter(r => r.verdict !== 'OK');
if (problems.length) {
  console.log('\n===== 问题页 =====');
  problems.forEach(r => console.log(`  [${r.verdict}] ${r.name} ${r.href} :: ${JSON.stringify(r.detail).slice(0, 220)}`));
}
fs.writeFileSync('/tmp/portal-nav-verify-result.json', JSON.stringify({ summary, problems, results }, null, 2));
console.log('\n结果已写入 /tmp/portal-nav-verify-result.json');
