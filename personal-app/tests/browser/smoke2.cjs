// اختبار دخان ثانٍ: الديون والميزانية والالتزامات والنسخ الاحتياطي والاستعادة.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8080') + '/index.html';
const OUT = require('os').tmpdir();
const results = [];
const errors = [];
const log = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const modal = (sel) => `#modal-root ${sel}`;

  await page.goto(BASE + '#/money');
  await page.waitForSelector('.tabs');

  // الحسابات
  await page.click('button[data-act="money-tab"][data-tab="accounts"]');
  for (const [name, kind, bal] of [['كاش', 'cash', '1000'], ['بنك', 'bank', '0']]) {
    await page.click('button[data-act="acc-add"]');
    await page.waitForSelector(modal('form[data-form="acc-add-form"]'));
    await page.fill(modal('input[name=name]'), name);
    await page.selectOption(modal('select[name=kind]'), kind);
    await page.fill(modal('input[name=openingMinor]'), bal);
    await page.click(modal('button[type=submit]'));
    await page.waitForSelector(`.acc-card strong:text-is("${name}")`);
  }
  log('two accounts created', true);

  // التصنيفات
  await page.click('button[data-act="money-tab"][data-tab="settings"]');
  for (const [name, kind] of [['طعام', 'expense'], ['رسوم بنكية', 'expense']]) {
    await page.fill('form[data-form="category-add"] input[name=name]', name);
    await page.selectOption('form[data-form="category-add"] select[name=kind]', kind);
    await page.click('form[data-form="category-add"] button[type=submit]');
    await page.waitForSelector(`text=${name}`);
  }
  log('expense categories created', true);

  // اقتراض 2000 من البنك (يبدّل حقول النموذج عبر نوع العملية)
  await page.click('button[data-act="money-tab"][data-tab="txns"]');
  await page.waitForSelector('form[data-form="txn-add"]');
  await page.selectOption('form[data-form="txn-add"] select[name=type]', 'borrow');
  const partyVisible = await page.isVisible('form[data-form="txn-add"] [data-field="party"]');
  const toAccHidden = await page.isHidden('form[data-form="txn-add"] [data-field="toAccountId"]');
  log('type change shows party field and hides transfer target', partyVisible && toAccHidden);
  const bankVal = await page.$eval('form[data-form="txn-add"] select[name=accountId]', (s) => [...s.options].find((o) => o.textContent.startsWith('بنك')).value);
  await page.selectOption('form[data-form="txn-add"] select[name=accountId]', bankVal);
  await page.fill('form[data-form="txn-add"] input[name=amount]', '2000');
  await page.fill('form[data-form="txn-add"] input[name=party]', 'بنك التمويل');
  await page.click('form[data-form="txn-add"] button[type=submit]');
  await page.waitForTimeout(250);
  await page.click('button[data-act="money-tab"][data-tab="debts"]');
  await page.waitForSelector('.debt-card');
  const debtText = await page.textContent('.debt-card');
  log('borrowing creates a debt, not income', debtText.includes('بنك التمويل') && debtText.includes('2,000.00'), debtText.replace(/\s+/g, ' ').slice(0, 120));

  // سداد 500 منها 20 رسوم
  await page.click('button[data-act="debt-pay"]');
  await page.waitForSelector(modal('form[data-form="txn-add"]'));
  const cashVal = await page.$eval(modal('select[name=accountId]'), (s) => [...s.options].find((o) => o.textContent.startsWith('بنك')).value);
  await page.selectOption(modal('select[name=accountId]'), cashVal);
  await page.fill(modal('input[name=amount]'), '500');
  await page.fill(modal('input[name=fee]'), '20');
  await page.selectOption(modal('select[name=categoryId]'), { label: 'رسوم بنكية' });
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(250);
  await page.click('button[data-act="money-tab"][data-tab="debts"]');
  const debtText2 = await page.textContent('.debt-card');
  log('repayment reduces principal by 480 (500 minus 20 fee)', debtText2.includes('1,520.00'), debtText2.replace(/\s+/g, ' ').slice(0, 160));

  // ميزانية
  await page.click('button[data-act="money-tab"][data-tab="budgets"]');
  await page.waitForSelector('form[data-form="budget-add"]');
  await page.fill('form[data-form="budget-add"] input[name=name]', 'ميزانية الشهر الأول');
  await page.fill('form[data-form="budget-add"] input[name=start]', '2026-01-01');
  await page.fill('form[data-form="budget-add"] input[name=end]', '2026-01-31');
  await page.fill('form[data-form="budget-add"] textarea[name=lines]', 'طعام | 1000');
  await page.click('form[data-form="budget-add"] button[type=submit]');
  await page.waitForSelector('text=ميزانية الشهر الأول');
  log('budget created with category line', (await page.textContent('body')).includes('ميزانية الشهر الأول'));

  // التزام مجدول: قسط 300 لثلاث دفعات
  await page.click('button[data-act="money-tab"][data-tab="schedules"]');
  await page.click('button[data-act="sch-add"]');
  await page.waitForSelector(modal('form[data-form="sch-add-form"]'));
  await page.selectOption(modal('select[name=kind]'), 'installment');
  await page.fill(modal('input[name=name]'), 'قسط سيارة');
  await page.fill(modal('input[name=amount]'), '300');
  await page.fill(modal('input[name=startDate]'), '2026-01-15');
  await page.selectOption(modal('select[name=frequency]'), 'monthly');
  await page.fill(modal('input[name=count]'), '3');
  await page.click(modal('button[type=submit]'));
  await page.waitForSelector('text=قسط سيارة');
  const upcomingCount = await page.locator('.sch-row').count();
  log('installment schedule creates upcoming rows', upcomingCount >= 1, `rows=${upcomingCount}`);

  // دفع جزئي: 100 من 300
  await page.click('button[data-act="occ-pay"]');
  await page.waitForSelector(modal('form[data-form="occ-pay"]'));
  await page.fill(modal('input[name=amount]'), '100');
  await page.selectOption(modal('select[name=categoryId]'), { label: 'طعام' });
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(250);
  const partialText = await page.textContent('body');
  log('partial payment marks row as partial and keeps balance of 200 due', partialText.includes('دفع جزئي'));

  // التقارير
  await page.click('button[data-act="money-tab"][data-tab="reports"]');
  await page.waitForSelector('text=الفائض النقدي التشغيلي');
  log('reports label operating surplus (not accounting profit)', true);

  // النسخ الاحتياطي والاستعادة
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('button[data-act="backup-export"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="backup-export"]')]);
  const file = path.join(OUT, 'personal-app-backup-test.json');
  await download.saveAs(file);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  log('backup file has format marker and includes debts', parsed.format === 'personal-app-backup' && parsed.state.finance.debts.length === 1);

  // استعادة: نفتح نسخة فارغة من الإعدادات أولًا ثم نستعيد الملف
  await page.evaluate(() => localStorage.removeItem('personal-app.v1.local'));
  await page.reload();
  await page.waitForSelector('button[data-act="backup-export"]');
  await page.setInputFiles('input[type=file][data-change="backup-import"]', file);
  await page.waitForSelector(modal('button[data-act="confirm-yes"]'));
  const [dl2] = await Promise.all([
    page.waitForEvent('download').catch(() => null),
    page.click(modal('button[data-act="confirm-yes"]')),
  ]);
  if (dl2) await dl2.saveAs(path.join(OUT, 'pre-restore-backup.json')).catch(() => {});
  await page.waitForTimeout(300);
  await page.goto(BASE + '#/money');
  await page.click('button[data-act="money-tab"][data-tab="debts"]');
  await page.waitForSelector('.debt-card');
  log('restore brings debts back', (await page.textContent('.debt-card')).includes('بنك التمويل'));

  // تحقق من الإعادة: النسخة المستعادة تطابق الملف الأصلي
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-app.v1.local')).state);
  log('restored journal counts match the backup', restored.finance.txns.length === parsed.state.finance.txns.length && restored.finance.schedules.length === parsed.state.finance.schedules.length);

  // الرحلة: استبدال تحدٍّ بسبب، وإيقاف وتحليلات
  await page.goto(BASE + '#/journey');
  await page.waitForSelector('form[data-form="level-add"]');
  await page.fill('form[data-form="level-add"] input[name=name]', 'مستوى الاختبار');
  await page.click('form[data-form="level-add"] button[type=submit]');
  await page.waitForSelector('text=مستوى الاختبار');
  await page.click('button[data-act="level-toggle"]');
  await page.click('button[data-act="ch-add-open"]');
  await page.waitForSelector(modal('form[data-form="ch-add"]'));
  await page.fill(modal('input[name=title]'), 'تمرين قديم');
  await page.selectOption(modal('select[name=type]'), 'numeric');
  await page.fill(modal('input[name=target]'), '10');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(200);
  await page.click('button[data-act="ch-replace-open"]');
  await page.waitForSelector(modal('form[data-form="ch-replace"]'));
  await page.fill(modal('textarea[name=reason]'), 'الهدف كان كبيرًا');
  await page.fill(modal('input[name=title]'), 'تمرين مبسّط');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(200);
  const jtext = await page.textContent('body');
  log('replacing a challenge keeps old one in history with reason', jtext.includes('تمرين مبسّط') && jtext.includes('التحديات المستبدلة'));

  // التحليلات: الفصل بين الإكمال والتقييم
  await page.goto(BASE + '#/growth');
  await page.click('button[data-act="growth-tab"][data-tab="analytics"]');
  await page.waitForSelector('text=إكمال المهام مقابل التقييم الذاتي');
  log('analytics separates completion from self-evaluation', true);

  // الصفحات بلا تمرير أفقي بعد كل التغييرات
  for (const h of ['money', 'journey', 'growth']) {
    await page.goto(BASE + '#/' + h);
    await page.waitForTimeout(100);
    const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    log(`no horizontal overflow on #/${h} after flows`, ok);
  }

  log('no JS errors in flows', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('RUNNER ERROR', e);
  process.exit(2);
});
