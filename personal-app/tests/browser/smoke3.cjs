// اختبار دخان ثالث: مسار الدخول والمزامنة الأولى مع Supabase (طلبات HTTP مُحاكاة بالكامل).
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

  const SUPA = 'https://supa.test.invalid';
  const seen = { token: null, rpc: [], getUserState: 0 };

  await page.route('**/config.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: `window.PERSONAL_APP_CONFIG={supabaseUrl:'${SUPA}',supabaseAnonKey:'sb_publishable_test'};` }),
  );
  await page.route(`${SUPA}/auth/v1/token*`, async (route) => {
    const req = route.request();
    seen.token = { method: req.method(), url: req.url(), body: JSON.parse(req.postData() || '{}'), apikey: req.headers()['apikey'] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', email: 'owner@example.test' } }),
    });
  });
  await page.route(`${SUPA}/rest/v1/user_state*`, async (route) => {
    seen.getUserState++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(`${SUPA}/rest/v1/rpc/save_user_state`, async (route) => {
    const req = route.request();
    seen.rpc.push({ method: req.method(), auth: req.headers()['authorization'], body: JSON.parse(req.postData() || '{}') });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '1' });
  });

  await page.goto(BASE + '#/growth');
  await page.waitForSelector('form[data-form="login"]', { timeout: 5000 });
  log('login gate shown when cloud configured and no session', true);
  log('login page states closed public signup', (await page.textContent('body')).includes('التسجيل العام مغلق'));

  await page.fill('form[data-form="login"] input[name=email]', 'owner@example.test');
  await page.fill('form[data-form="login"] input[name=password]', 'correct-horse');
  await page.click('form[data-form="login"] button[type=submit]');

  await page.waitForSelector('.topbar', { timeout: 5000 });
  await page.waitForTimeout(400);
  log('password grant request uses POST with email and apikey', seen.token?.method === 'POST' && seen.token?.body?.email === 'owner@example.test' && seen.token?.apikey === 'sb_publishable_test');

  // بعد الدخول: لا توجد نسخة في السحابة، فيُرسل الجهاز حالته الأولى بإصدار 0
  const chip = await page.textContent('.sync-chip');
  log('after first sync the status shows saved to cloud', chip.includes('محفوظ في السحابة'), chip.trim());
  log('RPC called once with expected version 0 and a request id', seen.rpc.length === 1 && seen.rpc[0].body.p_expected_version === 0 && /^[0-9a-f-]{36}$/.test(seen.rpc[0].body.p_request_id));
  log('RPC carries the bearer token of the signed-in owner', seen.rpc[0]?.auth === 'Bearer acc');
  log('state payload is a JSON object', typeof seen.rpc[0]?.body?.p_state === 'object' && seen.rpc[0]?.body?.p_state?.schemaVersion === 1);

  // عند الخروج: البيانات المحلية تُمسح بعد تأكيد
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('button[data-act="logout"]');
  await page.click('button[data-act="logout"]');
  await page.waitForSelector('#modal-root button[data-act="confirm-yes"]');
  await page.click('#modal-root button[data-act="confirm-yes"]');
  await page.waitForTimeout(300);
  const local = await page.evaluate(() => localStorage.getItem('personal-app.v1.local'));
  const session = await page.evaluate(() => localStorage.getItem('personal-app.v1.session'));
  log('sign out clears local data and session', local === null && session === null);
  log('sign out returns to the login gate', (await page.locator('form[data-form="login"]').count()) === 1);

  log('no JS errors in cloud flow', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('RUNNER ERROR', e);
  process.exit(2);
});
