// اختبار دخان خامس: هدف يتقسم لعادة، والعادة تحدّث تقدم التحدي تلقائيًا.
const { chromium } = require('playwright');

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8080') + '/index.html';
const results = [];
const errors = [];
const log = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // 1) مستوى وتحدٍّ رقمي: 60 صفحة
  await page.goto(BASE + '#/journey');
  await page.waitForSelector('form[data-form="level-add"]');
  await page.fill('form[data-form="level-add"] input[name=name]', 'القراءة');
  await page.click('form[data-form="level-add"] button[type=submit]');
  await page.waitForTimeout(150);
  await page.click('button[data-act="level-toggle"]');
  await page.click('button[data-act="ch-add-open"]');
  await page.waitForSelector('#modal-root form[data-form="ch-add"]');
  await page.fill('#modal-root input[name=title]', 'قراءة 60 صفحة');
  await page.selectOption('#modal-root select[name=type]', 'numeric');
  await page.fill('#modal-root input[name=target]', '60');
  await page.fill('#modal-root input[name=unit]', 'صفحة');
  await page.click('#modal-root button[type=submit]');
  await page.waitForTimeout(150);
  log('level with numeric challenge created', true);

  // 2) المستوى الحالي: إضافة عادة مربوطة بالتحدي
  await page.goto(BASE + '#/current');
  await page.waitForSelector('form[data-form="habit-add"]');
  await page.fill('form[data-form="habit-add"] input[name=title]', 'قراءة يومية');
  await page.selectOption('form[data-form="habit-add"] select[name=linkChallengeId]', { label: 'قراءة 60 صفحة' });
  await page.click('form[data-form="habit-add"] button[type=submit]');
  await page.waitForSelector('.habit-row:has-text("قراءة يومية")');
  const row = await page.textContent('.habit-row:has-text("قراءة يومية")');
  log('habit row appears with weekly progress 0 of 7', row.includes('0 من 7'), row.replace(/\s+/g, ' ').slice(0, 80));
  log('habit shows it counts toward the challenge', row.includes('تُحسب في: قراءة 60 صفحة'));

  // 3) تسجيل كمية اليوم: 15 صفحة
  const amountInput = page.locator('.habit-row:has-text("قراءة يومية") input[data-change="habit-amount"]');
  await amountInput.fill('15');
  await amountInput.press('Tab');
  await page.waitForTimeout(250);
  const habitRowAfter = await page.textContent('.habit-row:has-text("قراءة يومية")');
  log('logging 15 pages marks one day this week', habitRowAfter.includes('1 من 7'), habitRowAfter.replace(/\s+/g, ' ').slice(0, 80));

  // 4) تقدم التحدي تحدّث تلقائيًا إلى 15
  const challengeValue = await page.inputValue('input[data-change="ch-num"]');
  log('linked challenge progress updated to 15 automatically', challengeValue === '15', `value=${challengeValue}`);

  // 5) أرشفة العادة تعيد التقدم إلى صفر
  await page.click('.habit-row:has-text("قراءة يومية") button[data-act="habit-archive"]');
  await page.waitForTimeout(250);
  const challengeAfterArchive = await page.inputValue('input[data-change="ch-num"]');
  log('archiving the habit resets the linked progress to 0', challengeAfterArchive === '0', `value=${challengeAfterArchive}`);
  log('archived habit no longer listed', (await page.locator('.habit-row:has-text("قراءة يومية")').count()) === 0);

  log('no JS errors in habit flow', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('RUNNER ERROR', e);
  process.exit(2);
});
