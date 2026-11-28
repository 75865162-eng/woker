/**
 * 生产验证：门户页 8 个新接通入口是否渲染为可点击链接。
 * 用生产会话打开 /wimoor，搜索每个入口名，确认命中项为 <a data-entry-id href=...> 而非灰色 div。
 * 用法: node scripts/portal-8links-verify.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://aoocy.com';
const COOKIE_FILE = '/tmp/portal-verify-cookie.txt';
const targets = [
  { name: 'AI问答', href: '/ai/chat' },
  { name: '汇率管理', href: '/amazon/fx-rate' },
  { name: '凭证录入', href: '/operations/finance-ledger' },
  { name: '总账目', href: '/operations/finance-ledger' },
  { name: '明细账', href: '/operations/finance-ledger' },
  { name: '科目余额表', href: '/operations/finance-ledger' },
  { name: '辅助核算', href: '/operations/finance-ledger' },
  { name: '结账', href: '/operations/finance-ledger' },
];
const line = fs.readFileSync(COOKIE_FILE, 'utf8').split('\n').find(l => l.includes('amazon_bulk_ad_session'));
const parts = line.split('\t');
const sessionCookie = { name: parts[5], value: parts[6], url: BASE };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([sessionCookie]);
const page = await context.newPage();
await page.goto(BASE + '/wimoor', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('[data-wimoor-portal="1"]', { timeout: 20000 });

const results = [];
for (const t of targets) {
  const search = page.getByLabel('搜索页面');
  await search.fill(t.name);
  await page.waitForTimeout(250);
  const entry = page.locator(`[data-entry-id]:has-text("${t.name}")`).first();
  const tag = await entry.evaluate(el => el.tagName.toLowerCase());
  const href = await entry.getAttribute('href');
  const ok = tag === 'a' && href === t.href;
  results.push({ name: t.name, expected: t.href, tag, href, ok });
  console.log(`${ok ? '✅' : '❌'} ${t.name}: <${tag} href="${href}"> (期望 <a href="${t.href}">)`);
}
await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n汇总: ${pass}/${targets.length} 个新入口为可点击链接`);
fs.writeFileSync('/tmp/portal-8links-result.json', JSON.stringify(results, null, 2));
process.exit(pass === targets.length ? 0 : 1);
