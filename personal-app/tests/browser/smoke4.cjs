// اختبار دخان رابع: بنك متقدم، توزيع هدف، مطابقة وتسوية، تعديل عملية، إيقاف تحدٍّ، نقاط النمو، الحسابات الرقمية.
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
  const modal = (sel) => `#modal-root ${sel}`;
  // الحالة تبقى عند التنقل بالـ hash داخل الصفحة نفسها، لذلك نوسّع فقط إذا كان مغلقًا.
  const expand0 = async () => {
    if ((await page.locator('.level-card >> nth=0 >> .level-body').count()) === 0) {
      await page.click('.level-card >> nth=0 >> button[data-act="level-toggle"]');
    }
  };

  // --- نقاط النمو والمجال والملف الشخصي ---
  await page.goto(BASE + '#/growth');
  await page.waitForSelector('form[data-form="profile-save"]');
  await page.fill('form[data-form="profile-save"] input[name=name]', 'أحمد');
  await page.click('form[data-form="profile-save"] button[type=submit]');
  await page.waitForTimeout(150);
  log('profile name saved', (await page.inputValue('form[data-form="profile-save"] input[name=name]')) === 'أحمد');

  await page.click('button[data-act="growth-tab"][data-tab="points"]');
  await page.waitForSelector('form[data-form="domain-add"]');
  await page.fill('form[data-form="domain-add"] input[name=name]', 'الدراسة');
  await page.click('form[data-form="domain-add"] button[type=submit]');
  await page.waitForSelector('.chip:has-text("الدراسة")');
  log('domain added', true);

  await page.click('button[data-act="point-open-add"][data-kind="weakness"]');
  await page.waitForSelector(modal('form[data-form="point-add"]'));
  await page.fill(modal('input[name=name]'), 'تأجيل المراجعة');
  await page.selectOption(modal('select[name=initialScore]'), '4');
  await page.click(modal('button[type=submit]'));
  await page.waitForSelector('text=تأجيل المراجعة');
  await page.click('button[data-act="eval-open"]');
  await page.waitForSelector(modal('form[data-form="eval-add"]'));
  await page.selectOption(modal('select[name=score]'), '7');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(150);
  log('evaluation 4 → 7 shows improvement of +3', (await page.textContent('.points')).includes('تحسّن +3'));

  // --- بنك متقدم: تحرير عنصر بمهام وروابط ---
  await page.goto(BASE + '#/bank');
  await page.waitForSelector('form[data-form="bank-quick"]');
  await page.fill('form[data-form="bank-quick"] input[name=title]', 'هدف قراءة الكتب');
  await page.click('form[data-form="bank-quick"] button[type=submit]');
  await page.waitForSelector('text=هدف قراءة الكتب');
  await page.click('button[data-act="bank-edit"]');
  await page.waitForSelector(modal('form[data-form="bank-save"]'));
  await page.selectOption(modal('select[name=type]'), 'big_goal');
  await page.selectOption(modal('select[name=status]'), 'ready');
  await page.fill(modal('textarea[name=subtasks]'), 'قراءة الفصل الأول | binary | 1\nصفحات مقروءة | numeric | 120 | 2');
  await page.fill(modal('textarea[name=links]'), 'مصدر | https://example.com/books');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(200);
  const bankText = await page.textContent('body');
  log('big goal saved with type label and ready status', bankText.includes('هدف كبير') && bankText.includes('جاهزة'));
  log('goal card offers distribution action', (await page.locator('button[data-act="goal-open"]').count()) === 1);

  // --- الرحلة: مستويان، توزيع الهدف على أحدهما، إيقاف واستئناف ---
  await page.goto(BASE + '#/journey');
  await page.waitForSelector('form[data-form="level-add"]');
  for (const name of ['الأول', 'الثاني']) {
    await page.fill('form[data-form="level-add"] input[name=name]', name);
    await page.click('form[data-form="level-add"] button[type=submit]');
    await page.waitForTimeout(150);
  }
  log('two levels created', (await page.locator('.level-card').count()) === 2);
  await expand0();
  await page.click('.level-card >> nth=0 >> button[data-act="ch-from-bank-open"]').catch(() => {});

  // توزيع الهدف من البنك
  await page.goto(BASE + '#/bank');
  await page.click('button[data-act="goal-open"]');
  await page.waitForSelector(modal('form[data-form="goal-distribute"]'));
  await page.selectOption(modal('select[name=levelId_0]'), { label: 'الأول' });
  await page.fill(modal('input[name=title_0]'), 'الجزء الأول');
  await page.fill(modal('input[name=target_0]'), '6');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(200);
  await page.goto(BASE + '#/journey');
  await expand0();
  log('goal part became a challenge inside level one', (await page.textContent('.level-card >> nth=0')).includes('الجزء الأول'));

  // إيقاف وتحليلات
  await page.click('.level-card >> nth=0 >> button[data-act="ch-stop-open"]');
  await page.waitForSelector(modal('form[data-form="ch-stop"]'));
  await page.fill(modal('textarea[name=reason]'), 'ضغط الدراسة');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(150);
  log('stopped challenge shows متوقف badge', (await page.textContent('.level-card >> nth=0')).includes('متوقف'));

  // --- المستوى الحالي: المستوى الأول ليس حاليًا لأنه لا يملك تحديًا نشطًا مكتملًا... نتحقق أنه الحالي ---
  await page.goto(BASE + '#/current');
  await page.waitForSelector('.level-hero');
  log('current level shows reward/badge expectations block', (await page.textContent('.reward-line')).includes('المكافأة المنتظرة') || (await page.textContent('body')).includes('لا توجد مكافأة'));

  // --- المال: حساب بنكي، مطابقة، تسوية، تعديل عملية ---
  await page.goto(BASE + '#/money');
  await page.click('button[data-act="money-tab"][data-tab="accounts"]');
  await page.click('button[data-act="acc-add"]');
  await page.waitForSelector(modal('form[data-form="acc-add-form"]'));
  await page.fill(modal('input[name=name]'), 'بنك الراتب');
  await page.selectOption(modal('select[name=kind]'), 'bank');
  await page.fill(modal('input[name=openingMinor]'), '3000');
  await page.click(modal('button[type=submit]'));
  await page.waitForSelector('.acc-card strong:text-is("بنك الراتب")');
  await page.click('.acc-card:has-text("بنك الراتب") button[data-act="acc-reconcile"]');
  await page.waitForSelector(modal('form[data-form="recon-add"]'));
  await page.fill(modal('input[name=actual]'), '2950');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(200);
  const reconBal = await page.textContent('.acc-card:has-text("بنك الراتب") .acc-balance');
  log('reconciliation does not change balance silently', reconBal.includes('3,000.00'), reconBal.trim());
  await page.click('button[data-act="recon-adjust"]');
  await page.waitForTimeout(200);
  const adjBal = await page.textContent('.acc-card:has-text("بنك الراتب") .acc-balance');
  log('explicit adjustment moves balance to 2,950.00', adjBal.includes('2,950.00'), adjBal.trim());

  await page.click('button[data-act="money-tab"][data-tab="txns"]');
  await page.waitForSelector('.txn-list');
  await page.click('.txn-row >> nth=0 >> button[data-act="txn-edit"]');
  await page.waitForSelector(modal('form[data-form="txn-meta"]'));
  await page.fill(modal('input[name=note]'), 'تسوية مُعدّلة');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(200);
  log('transaction note edited and history recorded', (await page.textContent('.txn-list')).includes('تسوية مُعدّلة') && (await page.textContent('.txn-list')).includes('عُدّلت'));

  // --- حساباتي: تعديل خدمة ---
  await page.goto(BASE + '#/services');
  await page.click('button[data-act="svc-add"]');
  await page.waitForSelector(modal('form[data-form="svc-add"]'));
  await page.fill(modal('input[name=name]'), 'بنك');
  await page.fill(modal('input[name=url]'), 'javascript:alert(1)');
  await page.click(modal('button[type=submit]'));
  await page.waitForTimeout(150);
  log('unsafe link rejected with message in form', (await page.textContent(modal('.form-error'))).includes('http'));
  await page.fill(modal('input[name=url]'), 'https://bank.example.com');
  await page.fill(modal('input[name=managerRef]'), 'Personal / Banks / Bank');
  await page.click(modal('button[type=submit]'));
  await page.waitForSelector('text=بنك');
  const svcHref = await page.getAttribute('a[href="https://bank.example.com"]', 'rel');
  log('service opens with noopener link', svcHref === 'noopener noreferrer');

  log('no JS errors in extended flows', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('RUNNER ERROR', e);
  process.exit(2);
});
