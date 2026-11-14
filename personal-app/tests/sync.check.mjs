// اختبار آلية المزامنة بخادم وهمي يطابق قواعد save_user_state في schema.sql:
// - إصدار متوقع، ورفض عند التعارض (P0409)
// - معرّف طلب مكرر يُرجع الإصدار دون كتابة
// - الكتابة قد تنجح في الخادم ثم يضيع الرد (انقطاع بعد الكتابة)
// تشغيل: node --test personal-app/tests/sync.check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppStore } from '../src/data/store.js';
import { CloudError } from '../src/data/cloud.js';
import { addDomain } from '../src/core/growth.js';
import { newId } from '../src/core/state.js';

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

class FakeServer {
  constructor() {
    this.version = 0;
    this.state = null;
    this.lastRequestId = null;
    this.dropResponseOnce = false; // يكتب ثم يرمي خطأ شبكة (انقطاع قبل وصول الرد)
    this.networkDownCalls = 0;
    this.offline = false;
    this.writes = 0;
  }
  async fetchRemote() {
    if (this.offline) { this.networkDownCalls++; throw new CloudError('network', 'network', 0); }
    return { exists: this.state !== null, version: this.version, lastRequestId: this.lastRequestId, state: this.state };
  }
  async saveRemote(expected, state, requestId) {
    if (this.offline) { this.networkDownCalls++; throw new CloudError('network', 'network', 0); }
    if (requestId === this.lastRequestId) return this.version; // إعادة إرسال نفس الطلب
    if (expected !== this.version) throw new CloudError('version conflict', 'P0409', 409);
    this.version += 1;
    this.state = structuredClone(state);
    this.lastRequestId = requestId;
    this.writes += 1;
    if (this.dropResponseOnce) {
      this.dropResponseOnce = false;
      throw new CloudError('connection reset after write', 'network', 0);
    }
    return this.version;
  }
}

function makeCloud(server, email = 'owner@example.test') {
  const cloud = {
    configured: true,
    session: { access_token: 't' },
    email,
    signOut() { this.session = null; },
    fetchRemote: () => server.fetchRemote(),
    saveRemote: (e, s, r) => server.saveRemote(e, s, r),
  };
  return cloud;
}

function makeDevice(server, storage = new MemStorage()) {
  const store = new AppStore({ cloud: makeCloud(server), storage, now: () => '2026-11-12T10:00:00.000Z' });
  // تأخير طويل: لا تُعاد المحاولة تلقائيًا أثناء الاختبار، والاختبار يستدعي push() يدويًا.
  store.retryDelay = 3_600_000;
  return store;
}

function editName(store, name) {
  store.update((d) => { d.profile.name = name; });
}

// إلغاء مؤقت المزامنة حتى لا يبقى الاختبار حيًا.
function quiet(store) {
  clearTimeout(store.timer);
  store.timer = null;
}

test('الجهاز الأول ينشئ السحابة، والثاني يستقبل النسخة دون استبدال تعديلاته', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  editName(a, 'أحمد');
  quiet(a);
  await a.start(); // لا توجد نسخة بعد، فيُرسل الجهاز الأول حالته
  assert.equal(server.version, 1);
  assert.equal(a.sync.dirty, false);
  assert.equal(a.sync.status, 'synced');

  const b = makeDevice(server);
  quiet(b);
  await b.start();
  assert.equal(b.state.profile.name, 'أحمد', 'الجهاز الثاني يستقبل آخر نسخة');
  assert.equal(b.sync.serverVersion, 1);
});

test('تعديل من جهازين دون مزامنة: يظهر تعارض، ولا يُستبدل شيء بصمت', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  editName(a, 'أحمد');
  quiet(a);
  await a.start();

  const b = makeDevice(server);
  quiet(b);
  await b.start();

  // A يرسل تعديلًا أولًا
  editName(a, 'أحمد المحدّث');
  quiet(a);
  await a.push();
  assert.equal(server.version, 2);

  // B يعدّل محليًا دون إرسال، ثم يسحب
  editName(b, 'تعديل من B');
  quiet(b);
  await b.pull();
  assert.equal(b.sync.status, 'conflict', 'التعارض مكتشف');
  assert.equal(b.state.profile.name, 'تعديل من B', 'تعديلات B لم تُستبدل بصمت');
  assert.equal(server.state.profile.name, 'أحمد المحدّث', 'السحابة لم تتغير');

  // القرار للمستخدم: احتفظ بنسخة هذا الجهاز
  await b.resolveUseLocal();
  assert.equal(server.version, 3);
  assert.equal(server.state.profile.name, 'تعديل من B');
  assert.equal(b.sync.status, 'synced');
});

test('اختيار نسخة السحابة يستبدل الحالة المحلية بعد القرار فقط', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  editName(a, 'أ');
  quiet(a);
  await a.start();
  const b = makeDevice(server);
  quiet(b);
  await b.start();
  editName(a, 'أ2');
  quiet(a);
  await a.push();
  editName(b, 'ب-محلي');
  quiet(b);
  await b.pull();
  assert.equal(b.sync.status, 'conflict');
  await b.resolveUseRemote();
  assert.equal(b.state.profile.name, 'أ2');
  assert.equal(b.sync.dirty, false);
});

test('انقطاع بعد الكتابة: إعادة الإرسال بنفس المعرّف لا تكتب مرتين', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  quiet(a);
  await a.start(); // إنشاء السحابة
  const before = server.version;

  server.dropResponseOnce = true;
  editName(a, 'نسخة مهمة');
  quiet(a);
  await a.push(); // كُتبت في الخادم ثم ضاع الرد
  assert.equal(server.writes, 2, 'كُتبت مرة واحدة فعلًا');
  assert.equal(a.sync.status, 'offline');
  assert.ok(a.sync.pendingRequestId, 'المعرّف محفوظ للمحاولة التالية');

  quiet(a);
  await a.push(); // إعادة المحاولة
  assert.equal(server.writes, 2, 'إعادة الإرسال لم تُنشئ كتابة جديدة');
  assert.equal(server.version, before + 1);
  assert.equal(a.sync.dirty, false);
  assert.equal(a.sync.status, 'synced');
});

test('تعديل أثناء الانقطاع: لا يضيع، ويُرسل بعد إعادة الاتصال', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  quiet(a);
  await a.start();

  server.dropResponseOnce = true;
  editName(a, 'الأول');
  quiet(a);
  await a.push(); // كُتب "الأول" في الخادم وضاع الرد

  // تعديل جديد قبل إعادة المحاولة
  editName(a, 'الثاني');
  quiet(a);
  await a.push(); // نفس المعرّف يُرجع الإصدار دون كتابة، فيبقى الجهاز "قذرًا" ويرسل مرة أخرى
  assert.equal(server.state.profile.name, 'الثاني', 'التعديل الأخير وصل إلى السحابة');
  assert.equal(a.sync.dirty, false);
});

test('انقطاع الشبكة: التعديلات محفوظة محليًا وتظهر الحالة بلا اتصال', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  quiet(a);
  await a.start();
  server.offline = true;
  editName(a, 'بلا اتصال');
  quiet(a);
  await a.push();
  assert.equal(a.sync.status, 'offline');
  assert.equal(a.sync.dirty, true);
  const restored = makeDevice(server, a.storage);
  assert.equal(restored.state.profile.name, 'بلا اتصال', 'النسخة المحلية بقيت بعد إعادة التحميل');
  assert.equal(restored.sync.dirty, true);
});

test('الخروج يمسح البيانات المحلية ويترك السحابة كما هي', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  quiet(a);
  await a.start();
  editName(a, 'محذوف محليًا');
  quiet(a);
  await a.push();
  a.signOutAndClear();
  assert.equal(a.state.profile.name, '', 'الحالة المحلية فارغة');
  assert.equal(a.storage.getItem('personal-app.v1.local'), null);
  assert.equal(server.state.profile.name, 'محذوف محليًا', 'السحابة لم تتأثر');
});

test('معرّفات الطلبات فريدة لكل تعديل مُرسَل', async () => {
  const server = new FakeServer();
  const a = makeDevice(server);
  quiet(a);
  await a.start();
  const seen = new Set();
  const orig = server.saveRemote.bind(server);
  server.saveRemote = async (e, s, r) => { seen.add(r); return orig(e, s, r); };
  for (let i = 0; i < 3; i++) {
    editName(a, 'n' + i);
    quiet(a);
    await a.push();
  }
  assert.equal(seen.size, 3);
  void addDomain; void newId;
});
