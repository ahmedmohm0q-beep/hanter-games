// Browser smoke test against the single-file preview (local storage mode).
// Usage: serve dist-preview on :4173, then `node scripts/e2e-preview.mjs`
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4173/';
const SHOTS = process.env.SHOTS ?? '/tmp/hg-shots';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Dubai' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text()) && errors.push(m.text()));

await page.goto(BASE);
await page.getByRole('button', { name: 'استخدم على هذا الجهاز فقط' }).click();
// onboarding
await page.locator('input[type=date]').fill('2026-11-15');
check('onboarding shows last day of plan year', await page.getByText('14 نوفمبر 2027').count() > 0 || (await page.content()).includes('2027'));
await page.getByRole('button', { name: 'ابدأ الخطة' }).click();
await page.waitForSelector('text=خطوة مقترحة للبدء');
check('dashboard loads after onboarding', true);

// year: create goal with its own deadline
await page.goto(BASE + '#/year');
await page.getByRole('button', { name: /هدف جديد/ }).first().click();
await page.getByLabel('العنوان').fill('اجتياز CMA Part 1');
await page.getByLabel('الموعد النهائي').fill('2027-03-10');
await page.getByRole('button', { name: 'حفظ' }).click();
await page.waitForSelector('text=اجتياز CMA Part 1');
check('goal card shows its own deadline', (await page.locator('.goalcard').first().innerText()).includes('2027'));

// three boxes: typing does not open the goal drill-down
await page.getByRole('button', { name: /أضف نقطة: المخاوف/ }).click();
const ta = page.locator('.box.fears textarea').first();
await ta.click();
await ta.click();
// type key by key like a phone keyboard, then stay in the box while the auto-save runs
await page.keyboard.type('ضيق الوقت قبل الامتحان.', { delay: 30 });
await page.waitForTimeout(1500);
const live = await ta.inputValue();
check('auto-save keeps the last typed character', live === 'ضيق الوقت قبل الامتحان.', JSON.stringify(live));
await page.keyboard.press('Enter');
await page.keyboard.type('سطر', { delay: 30 });
await page.waitForTimeout(1500);
check('auto-save keeps a new line', (await ta.inputValue()) === 'ضيق الوقت قبل الامتحان.\nسطر', JSON.stringify(await ta.inputValue()));
await ta.blur();
await page.waitForTimeout(300);
await page.reload();
await page.locator('.box.fears textarea').first().waitFor();
check('typed point survives reload exactly', (await page.locator('.box.fears textarea').first().inputValue()) === 'ضيق الوقت قبل الامتحان.\nسطر');
check('typing in a box does not open the goal list', (await page.locator('.goalcard').first().getAttribute('aria-expanded')) === 'false');
await page.waitForTimeout(300);

// open drill-down and add a sub-goal + habit + task
await page.locator('.goalcard').first().click();
check('clicking the card opens sub-goals', (await page.locator('.goalcard').first().getAttribute('aria-expanded')) === 'true');
await page.getByRole('button', { name: '＋ هدف فرعي' }).click();
await page.getByLabel('العنوان').fill('إنهاء Section A');
await page.getByLabel('الموعد النهائي').fill('2026-12-31');
await page.getByRole('button', { name: 'حفظ' }).click();
await page.getByRole('button', { name: '＋ عادة' }).first().click();
await page.getByLabel('العنوان').fill('مذاكرة');
await page.getByLabel('طريقة القياس').selectOption('minutes');
await page.getByLabel('المستهدف لكل مرة').fill('40');
await page.getByLabel('يسري من').fill('2026-11-03');
await page.getByRole('button', { name: 'حفظ' }).click();
await page.waitForTimeout(400);
check('habit appears as a cloud under its goal', (await page.locator('.station .habits .cloud', { hasText: 'مذاكرة' }).count()) === 1);
check('motivation, fears and obstacles sit beside the goal', (await page.locator('.station .clouds .thought').count()) === 3);
check('a branch line is drawn to every cloud', (await page.locator('.station .branch-lines path').count()) === (await page.locator('.station .node').count()));
await page.getByRole('button', { name: '＋ مهمة' }).first().click();
await page.getByLabel('العنوان').fill('حل 30 سؤال');
await page.getByLabel('تاريخ الاستحقاق').fill('2026-11-20');
await page.getByRole('button', { name: 'حفظ' }).click();
await page.waitForSelector('text=حل 30 سؤال');

// navigate from yearly goal to the task's day
await page.getByRole('link', { name: /حل 30 سؤال/ }).click();
await page.waitForURL(/#\/day\/2026-11-20\?focus=t%3A|#\/day\/2026-11-20\?focus=t:/);
check('task link opens its correct day', page.url().includes('/day/2026-11-20'));
await page.locator('.occ.hl').first().waitFor({ timeout: 3000 }).catch(() => {});
check('task is highlighted on that day', await page.locator('.occ.hl').count() === 1);
await page.reload();
check('deep link survives reload', (await page.locator('.occ.hl').count()) === 1 && page.url().includes('2026-11-20'));

// today: log 20 of 40 minutes
await page.goto(BASE + '#/day/2026-11-03');
const row = page.locator('article.occ', { hasText: 'مذاكرة' });
await row.getByRole('button', { name: /\+15/ }).click();
await row.getByRole('button', { name: /\+5/ }).click();
const now = await row.getAttribute('aria-label');
const bar = await row.locator('[role=progressbar]').getAttribute('aria-valuenow');
check('20 of 40 minutes = 50% for the occurrence', bar === '50', `aria-valuenow=${bar} (${now})`);

// XP cannot be farmed by undo/redo
const xpText = async () => (await page.locator('.topbar .chip.gold').innerText());
await row.getByRole('button', { name: /^\+\d/ }).first().click(); // +5
await row.getByRole('button', { name: /\+15/ }).click(); // reaches 40 → done
const xpDone = await xpText();
for (let k = 0; k < 3; k++) {
  await row.getByRole('button', { name: /تراجع/ }).click();
  await row.getByRole('button', { name: /إكمال/ }).click();
}
check('completion earns XP once', /\b10 XP/.test(xpDone), xpDone);
check('undo/redo does not add XP', (await xpText()) === xpDone, `${xpDone} → ${await xpText()}`);

// persistence after reload
await page.reload();
check('logged data persists after reload', (await page.locator('article.occ', { hasText: 'مذاكرة' }).getAttribute('aria-label')) !== null && (await page.locator('article.occ', { hasText: 'مذاكرة' }).locator('.chip.green').count()) > 0);

// a second tab (same device) receives the update live via BroadcastChannel
const page2 = await ctx.newPage();
await page2.goto(BASE + '#/day/2026-11-04');
await page2.locator('article.occ', { hasText: 'مذاكرة' }).waitFor();
await page.goto(BASE + '#/day/2026-11-04');
await page.locator('article.occ', { hasText: 'مذاكرة' }).getByRole('button', { name: /\+15/ }).click();
await page2.waitForTimeout(600);
const v1 = await page.locator('article.occ', { hasText: 'مذاكرة' }).locator('[role=progressbar]').getAttribute('aria-valuenow');
const v2 = await page2.locator('article.occ', { hasText: 'مذاكرة' }).locator('[role=progressbar]').getAttribute('aria-valuenow');
check('second tab shows the new log without reload', v2 === '38', `tab2=${v2} tab1=${v1} url2=${page2.url()}`);
await page2.close();

// analytics page renders three separate measures
await page.goto(BASE + '#/analytics?type=month&date=2026-11-20');
check('analytics shows commitment / plan / outcome separately', (await page.getByText('الالتزام بالتنفيذ').count()) > 0 && (await page.getByText('التقدم في الخطة').count()) > 0);

// responsive screenshots + horizontal overflow check
for (const [w, h] of [[360, 780], [768, 1024], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const r of ['', 'year', 'day/2026-11-03', 'analytics']) {
    await page.goto(BASE + '#/' + r);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal scroll at ${w}px on /${r || 'dashboard'}`, overflow <= 1, `overflow=${overflow}`);
    await page.screenshot({ path: `${SHOTS}/${w}-${(r || 'dashboard').replace(/\W/g, '_')}.png`, fullPage: true });
  }
}

// English / LTR
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + '#/settings');
await page.getByLabel('اللغة').selectOption('en');
await page.waitForTimeout(200);
check('switching to English sets dir=ltr', (await page.evaluate(() => document.documentElement.dir)) === 'ltr');
await page.goto(BASE + '#/year');
await page.screenshot({ path: `${SHOTS}/en-year.png`, fullPage: true });

// light theme
await page.goto(BASE + '#/settings');
await page.getByLabel('Theme').selectOption('light');
await page.goto(BASE + '#/');
await page.screenshot({ path: `${SHOTS}/light-dashboard.png`, fullPage: true });

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
