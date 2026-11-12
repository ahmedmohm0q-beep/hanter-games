// المتجر: حالة واحدة في الذاكرة + نسخة محلية فورية + مزامنة سحابية بإصدارات.
// قواعد المزامنة:
// - كل تعديل يُحفظ محليًا فورًا، ثم يُرسَل للسحابة بعد تأخير قصير.
// - الحفظ السحابي مشروط بالإصدار المتوقع. إذا تغيّر الإصدار في السحابة من جهاز آخر
//   يظهر تعارض، ولا يُستبدل شيء بصمت.
// - كل طلب حفظ له معرّف ثابت (request id) يُعاد استخدامه عند إعادة المحاولة، فلا تتكرر الكتابة.

import { normalizeState, defaultState, newId } from '../core/state.js';
import { settlePlan } from '../core/plan.js';
import { CloudError } from './cloud.js';

const LOCAL_KEY = 'personal-app.v1.local';
const SAVE_DELAY_MS = 1200;

// مؤقت لا يُبقي عملية Node حيّة (يفيد الاختبارات). في المتصفح يعمل كمؤقت عادي.
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}

export class AppStore {
  constructor({ cloud, storage = globalThis.localStorage, now = () => new Date().toISOString() }) {
    this.cloud = cloud;
    this.storage = storage;
    this.now = now;
    this.listeners = new Set();
    this.timer = null;
    this.pushing = false;
    this.retryDelay = 2000;
    this.notice = null;

    const loaded = this.loadLocal();
    this.state = loaded.state;
    this.sync = {
      status: 'local',
      serverVersion: loaded.serverVersion,
      dirty: loaded.dirty,
      pendingRequestId: loaded.pendingRequestId,
      pendingRevision: loaded.pendingRevision,
      lastSyncedAt: loaded.lastSyncedAt,
      conflict: null,
      error: null,
    };
    this.refreshStatusFromConfig();
  }

  // --- الاشتراك ---
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  refreshStatusFromConfig() {
    if (!this.cloud.configured) this.sync.status = 'local';
    else if (!this.cloud.session) this.sync.status = 'signed_out';
    else if (this.sync.dirty) this.sync.status = 'pending';
    else this.sync.status = 'synced';
  }

  // --- الحفظ المحلي ---
  loadLocal() {
    const fresh = () => ({
      state: normalizeState(defaultState(this.now())),
      serverVersion: 0,
      dirty: false,
      pendingRequestId: null,
      pendingRevision: null,
      lastSyncedAt: null,
    });
    let raw = null;
    try {
      raw = this.storage.getItem(LOCAL_KEY);
    } catch {
      return fresh();
    }
    if (!raw) return fresh();
    try {
      const rec = JSON.parse(raw);
      return {
        state: normalizeState(rec.state),
        serverVersion: Number(rec.serverVersion) || 0,
        dirty: Boolean(rec.dirty),
        pendingRequestId: rec.pendingRequestId || null,
        pendingRevision: rec.pendingRevision ?? null,
        lastSyncedAt: rec.lastSyncedAt || null,
      };
    } catch {
      // نسخة تالفة: تُحفظ جانبًا ولا تُمسح، ويبدأ التطبيق بحالة فارغة مع تنبيه.
      try {
        this.storage.setItem(`${LOCAL_KEY}.corrupt`, raw);
      } catch {
        // لا شيء نفعله إن فشل الحفظ الجانبي.
      }
      this.notice = 'النسخة المحلية كانت تالفة؛ حُفظت جانبًا. استعد نسخة احتياطية إن كانت لديك.';
      return fresh();
    }
  }

  persistLocal() {
    const record = {
      v: 1,
      state: this.state,
      serverVersion: this.sync.serverVersion,
      dirty: this.sync.dirty,
      pendingRequestId: this.sync.pendingRequestId,
      pendingRevision: this.sync.pendingRevision,
      lastSyncedAt: this.sync.lastSyncedAt,
      savedAt: this.now(),
    };
    try {
      this.storage.setItem(LOCAL_KEY, JSON.stringify(record));
      return true;
    } catch {
      this.sync.error = 'تعذّر الحفظ على هذا الجهاز (مساحة المتصفح قد تكون ممتلئة). صدّر نسخة احتياطية الآن.';
      return false;
    }
  }

  // تعديل واحد = دفعة واحدة. إذا رمت الدالة خطأ لا يتغير شيء.
  update(mutator) {
    const draft = structuredClone(this.state);
    const result = mutator(draft);
    settlePlan(draft, this.now());
    draft.revision = (this.state.revision || 0) + 1;
    this.state = normalizeState(draft);
    this.sync.dirty = true;
    this.sync.error = null;
    this.persistLocal();
    this.scheduleSave();
    this.emit();
    return result;
  }

  // --- المزامنة ---
  isSyncEnabled() {
    return this.cloud.configured && Boolean(this.cloud.session);
  }

  async start() {
    this.refreshStatusFromConfig();
    this.emit();
    if (!this.isSyncEnabled()) return;
    await this.pull();
  }

  setStatus(status, error = null) {
    this.sync.status = status;
    this.sync.error = error;
    this.emit();
  }

  scheduleSave() {
    if (!this.isSyncEnabled() || this.sync.conflict) return;
    if (!this.sync.dirty) return;
    clearTimeout(this.timer);
    this.timer = later(() => this.push(), SAVE_DELAY_MS);
    this.sync.status = 'pending';
  }

  async pull() {
    if (!this.isSyncEnabled()) return;
    this.setStatus('syncing');
    let remote;
    try {
      remote = await this.cloud.fetchRemote();
    } catch (e) {
      return this.handleNetworkOrAuth(e);
    }

    // إذا كان آخر طلب ناجحًا قبل إغلاق الصفحة، نعترف به دون تكراره.
    if (this.sync.pendingRequestId && remote.lastRequestId === this.sync.pendingRequestId) {
      this.sync.serverVersion = remote.version;
      this.sync.dirty = this.state.revision !== this.sync.pendingRevision;
      this.sync.pendingRequestId = null;
      this.sync.pendingRevision = null;
      this.persistLocal();
    }

    if (!remote.exists) {
      if (this.sync.serverVersion === 0) {
        this.sync.dirty = true;
        this.persistLocal();
        return this.push();
      }
      this.sync.conflict = { kind: 'missing_remote' };
      return this.setStatus('conflict');
    }

    if (remote.version === this.sync.serverVersion) {
      if (this.sync.dirty) return this.push();
      this.sync.lastSyncedAt = this.now();
      return this.setStatus('synced');
    }

    if (remote.version > this.sync.serverVersion && !this.sync.dirty) {
      return this.adoptRemote(remote);
    }

    // تعديلات محلية غير مرسلة + نسخة أحدث في السحابة: لا استبدال صامت.
    this.sync.conflict = { kind: 'diverged', remoteVersion: remote.version, remoteState: remote.state, remoteAt: null };
    return this.setStatus('conflict');
  }

  adoptRemote(remote) {
    this.state = normalizeState(remote.state);
    this.sync.serverVersion = remote.version;
    this.sync.dirty = false;
    this.sync.pendingRequestId = null;
    this.sync.pendingRevision = null;
    this.sync.conflict = null;
    this.sync.lastSyncedAt = this.now();
    this.persistLocal();
    this.setStatus('synced');
  }

  async push() {
    if (!this.isSyncEnabled() || this.sync.conflict) return;
    if (!this.sync.dirty) return this.setStatus('synced');
    if (this.pushing) return;
    this.pushing = true;
    let again = false;
    try {
      if (!this.sync.pendingRequestId) {
        this.sync.pendingRequestId = newId();
        this.sync.pendingRevision = this.state.revision;
        this.persistLocal();
      }
      this.setStatus('syncing');
      const payload = JSON.parse(JSON.stringify(this.state));
      const newVersion = await this.cloud.saveRemote(this.sync.serverVersion, payload, this.sync.pendingRequestId);
      this.sync.serverVersion = Number(newVersion);
      const sameRevision = this.state.revision === this.sync.pendingRevision;
      this.sync.pendingRequestId = null;
      this.sync.pendingRevision = null;
      this.sync.dirty = !sameRevision;
      this.sync.lastSyncedAt = this.now();
      this.retryDelay = 2000;
      this.persistLocal();
      if (this.sync.dirty) {
        // وصلت تعديلات أثناء الإرسال: نرسلها فورًا بطلب جديد.
        again = true;
      } else {
        this.setStatus('synced');
      }
    } catch (e) {
      if (e instanceof CloudError && e.code === 'P0409') {
        // خادم فيه إصدار أحدث: لم يُكتب شيء من طلبنا. نفحص ونعرض التعارض.
        this.sync.pendingRequestId = null;
        this.sync.pendingRevision = null;
        this.persistLocal();
        this.pushing = false;
        return this.pull();
      }
      this.handleNetworkOrAuth(e);
    } finally {
      this.pushing = false;
    }
    if (again) return this.push();
  }

  handleNetworkOrAuth(e) {
    if (e instanceof CloudError && (e.code === 'auth' || e.status === 401)) {
      this.setStatus('auth', 'انتهت جلسة الدخول. سجّل الدخول لمتابعة المزامنة. التعديلات محفوظة على هذا الجهاز.');
      return;
    }
    // شبكة أو خادم: نعيد المحاولة بتأخير متزايد. التعديلات محفوظة محليًا.
    this.setStatus('offline', 'لا اتصال بالخادم الآن. التعديلات محفوظة على هذا الجهاز وستُرسل تلقائيًا.');
    clearTimeout(this.timer);
    this.timer = later(() => this.push(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
  }

  // --- حل التعارض: القرار للمستخدم فقط، ويجب تنزيل نسخة احتياطية قبل أي استبدال ---
  async resolveUseLocal() {
    const remote = await this.cloud.fetchRemote();
    this.sync.serverVersion = remote.exists ? remote.version : 0;
    this.sync.conflict = null;
    this.sync.dirty = true;
    this.sync.pendingRequestId = null;
    this.sync.pendingRevision = null;
    this.persistLocal();
    return this.push();
  }

  async resolveUseRemote() {
    const remote = await this.cloud.fetchRemote();
    if (!remote.exists) throw new CloudError('لا توجد نسخة في السحابة', 'missing');
    return this.adoptRemote(remote);
  }

  async fetchRemoteSnapshot() {
    return this.cloud.fetchRemote();
  }

  // --- تسجيل الخروج: يمسح البيانات المحلية بعد أن يطلب المستخدم تأكيدًا ---
  signOutAndClear() {
    clearTimeout(this.timer);
    this.cloud.signOut();
    try {
      this.storage.removeItem(LOCAL_KEY);
    } catch {
      // نتجاهل: المتصفح قد يمنع التخزين.
    }
    this.state = normalizeState(defaultState(this.now()));
    this.sync = {
      status: this.cloud.configured ? 'signed_out' : 'local',
      serverVersion: 0,
      dirty: false,
      pendingRequestId: null,
      pendingRevision: null,
      lastSyncedAt: null,
      conflict: null,
      error: null,
    };
    this.emit();
  }

  // استيراد نسخة احتياطية: يستبدل الحالة بالكامل وتُرسل للسحابة كتعديل عادي.
  replaceWithBackup(state) {
    const next = normalizeState(structuredClone(state));
    next.revision = (this.state.revision || 0) + 1;
    this.state = next;
    this.sync.dirty = true;
    this.sync.conflict = null;
    this.persistLocal();
    this.scheduleSave();
    this.emit();
  }
}
