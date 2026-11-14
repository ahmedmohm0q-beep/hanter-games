// اختبار دخان في المتصفح: مسار كامل على شاشة هاتف 390px.
const { chromium } = require('playwright');

const BASE = (process.env.APP_URL || 'http://127.0.0.1:8080') + '/index.html';
const results = [];
const errors = [];
const log = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // 1) الإقلاع والاتجاه
  await page.goto(BASE + '#/growth');
  await page.waitForSelector('.topbar', { timeout: 5000 });
  log('boot renders topbar', true);
  log('html dir is rtl', (await page.getAttribute('html', 'dir')) === 'rtl');
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  log('no horizontal scroll at 390px (growth)', noOverflow);
  log('local-only banner shown when cloud not configured', (await page.textContent('body')).includes('وضع هذا الجهاز فقط'));

  // 2) المستوى والتحدي
  await page.goto(BASE + '#/journey');
  await page.waitForSelector('form[data-form="level-add"]');
  await page.fill('form[data-form="level-add"] input[name=name]', 'المستوى الأول');
  await page.fill('form[data-form="level-add"] input[name=rewardTitle]', 'قهوة مختصة');
  await page.fill('form[data-form="level-add"] input[name=badgeName]', 'البداية');
  await page.fill('form[data-form="level-add"] input[name=badgeIcon]', '🌱');
  await page.click('form[data-form="level-add"] button[type=submit]');
  await page.waitForSelector('text=المستوى الأول');
  log('level created', true);

  await page.click('button[data-act="level-toggle"]');
  await page.click('button[data-act="ch-add-open"]');
  await page.waitForSelector('form[data-form="ch-add"]');
  await page.fill('form[data-form="ch-add"] input[name=title]', 'قراءة فصل كامل');
  await page.click('form[data-form="ch-add"] button[type=submit]');
  await page.waitForSelector('.overlay', { state: 'detached', timeout: 3000 }).catch(() => {});
  log('challenge added to level', (await page.textContent('body')).includes('قراءة فصل كامل'));

  // 3) المستوى الحالي وإكمال التحدي
  await page.goto(BASE + '#/current');
  await page.waitForSelector('.level-hero');
  const heroName = await page.textContent('.level-hero h2');
  log('current level is the prepared one', heroName.includes('المستوى الأول'), heroName.trim());
  await page.click('button.done-btn');
  await page.waitForTimeout(300);
  const body1 = await page.textContent('body');
  log('completing the only challenge completes the level', body1.includes('أكملت المستويات المجهزة'));
  await page.goto(BASE + '#/journey');
  await page.waitForSelector('.levels');
  const journeyText = await page.textContent('.levels');
  log('completed level shows as مكتمل', journeyText.includes('مكتمل'));

  // 4) المكافأة لا تُمنح مرتين عند إعادة التحميل
  const awards = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-app.v1.local')).state.awards.length);
  log('reward and badge awarded exactly once', awards === 2, `awards=${awards}`);

  // 5) البنك: إضافة سريعة
  await page.goto(BASE + '#/bank');
  await page.waitForSelector('form[data-form="bank-quick"]');
  await page.fill('form[data-form="bank-quick"] input[name=title]', 'قراءة 20 دقيقة يوميًا');
  await page.click('form[data-form="bank-quick"] button[type=submit]');
  await page.waitForSelector('text=قراءة 20 دقيقة يوميًا');
  log('bank quick add works', true);

  // 6) حساباتي: خدمة بدون حقول سرية
  await page.goto(BASE + '#/services');
  await page.click('button[data-act="svc-add"]');
  await page.waitForSelector('form[data-form="svc-add"]');
  await page.fill('form[data-form="svc-add"] input[name=name]', 'البريد');
  await page.fill('form[data-form="svc-add"] input[name=url]', 'https://mail.example.com');
  await page.fill('form[data-form="svc-add"] input[name=managerRef]', 'Personal / Mail');
  await page.click('form[data-form="svc-add"] button[type=submit]');
  await page.waitForSelector('text=البريد');
  log('service saved', true);

  // 7) المال: تصنيف، حساب، عملية مصروف، ثم الرصيد
  await page.goto(BASE + '#/money');
  await page.waitForSelector('.tabs');
  await page.click('button[data-act="money-tab"][data-tab="settings"]');
  await page.waitForSelector('form[data-form="category-add"]');
  await page.fill('form[data-form="category-add"] input[name=name]', 'طعام');
  await page.click('form[data-form="category-add"] button[type=submit]');
  await page.waitForSelector('text=طعام');
  log('expense category added', true);

  await page.click('button[data-act="money-tab"][data-tab="accounts"]');
  await page.click('button[data-act="acc-add"]');
  await page.waitForSelector('form[data-form="acc-add-form"]');
  await page.fill('form[data-form="acc-add-form"] input[name=name]', 'كاش');
  await page.fill('form[data-form="acc-add-form"] input[name=openingMinor]', '1000');
  await page.click('form[data-form="acc-add-form"] button[type=submit]');
  await page.waitForSelector('text=كاش');
  const bal1 = await page.textContent('.acc-balance');
  log('account shows opening balance 1,000.00', bal1.includes('1,000.00'), bal1.trim());

  await page.click('button[data-act="money-tab"][data-tab="txns"]');
  await page.waitForSelector('form[data-form="txn-add"]');
  const accValue = await page.$eval('form[data-form="txn-add"] select[name=accountId]', (s) => s.options[1].value);
  await page.selectOption('form[data-form="txn-add"] select[name=accountId]', accValue);
  await page.selectOption('form[data-form="txn-add"] select[name=categoryId]', { label: 'طعام' });
  await page.fill('form[data-form="txn-add"] input[name=amount]', '50.50');
  await page.fill('form[data-form="txn-add"] input[name=party]', 'سوبرماركت');
  await page.click('form[data-form="txn-add"] button[type=submit]');
  await page.waitForSelector('text=تم تسجيل العملية', { timeout: 3000 }).catch(() => {});
  await page.click('button[data-act="money-tab"][data-tab="accounts"]');
  const bal2 = await page.textContent('.acc-balance');
  log('expense of 50.50 reduces balance to 949.50', bal2.includes('949.50'), bal2.trim());

  // 8) التقارير: المصروف لا يظهر دخلًا، والرصيد الافتتاحي ليس دخلًا
  await page.click('button[data-act="money-tab"][data-tab="reports"]');
  await page.waitForSelector('.table-wrap');
  const repText = await page.textContent('.table-wrap');
  log('reports show expenses 50.50 and income 0.00', repText.includes('50.50') && repText.includes('0.00'));

  // 9) الإعدادات: تبديل اسم التطبيق
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('form[data-form="settings-save"]');
  await page.fill('form[data-form="settings-save"] input[name=appName]', 'مساري');
  await page.click('form[data-form="settings-save"] button[type=submit]');
  await page.waitForTimeout(200);
  const brand = await page.textContent('.brand strong');
  log('app name editable from settings', brand.trim() === 'مساري', brand.trim());

  // 10) التنقل وعدم التمرير الأفقي
  for (const h of ['growth', 'bank', 'journey', 'current', 'money', 'services', 'settings']) {
    await page.goto(BASE + '#/' + h);
    await page.waitForTimeout(120);
    const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    log(`no horizontal overflow on #/${h}`, ok);
  }

  // 11) لقطة شاشة للتحقق البصري
  await page.goto(BASE + '#/current');
  await page.waitForTimeout(150);
  await page.screenshot({ path: require('os').tmpdir() + '/current-390.png', fullPage: false });

  log('no JS errors during run', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('RUNNER ERROR', e);
  process.exit(2);
});
