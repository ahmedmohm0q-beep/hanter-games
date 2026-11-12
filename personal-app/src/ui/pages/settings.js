import { ctx } from '../ctx.js';
import { esc, options, formData, badge } from '../util.js';
import { openModal, toast, confirmDialog, closeModal } from '../modal.js';
import { runForm, errMsg } from '../run.js';
import { exportBackup, parseBackup, backupFileName } from '../../core/backup.js';
import { DEFAULT_CURRENCIES, ValidationError } from '../../core/money.js';
import { SCHEMA_VERSION } from '../../core/state.js';

export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBackupNow() {
  const text = exportBackup(ctx.store.state, new Date().toISOString());
  downloadText(backupFileName(new Date()), text);
}

const STATUS_TEXT = {
  local: ['على هذا الجهاز فقط', ''],
  signed_out: ['غير مسجّل الدخول', 'warn'],
  pending: ['بانتظار الإرسال إلى السحابة', ''],
  syncing: ['جاري المزامنة…', ''],
  synced: ['محفوظ في السحابة', 'good'],
  offline: ['بلا اتصال: محفوظ على هذا الجهاز', 'warn'],
  auth: ['انتهت الجلسة: سجّل الدخول', 'warn'],
  conflict: ['تعارض يحتاج قرارك', 'warn'],
  error: ['خطأ في الحفظ', 'warn'],
};

// وقت محلي للجهاز (وليس UTC) لعرض آخر حفظ.
export function localTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
}

export function syncChip(store) {
  const [text, tone] = STATUS_TEXT[store.sync.status] || ['—', ''];
  const when = store.sync.lastSyncedAt ? ` · ${new Date(store.sync.lastSyncedAt).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<span class="sync-chip ${tone}" role="status">${esc(text)}${store.sync.status === 'synced' ? esc(when) : ''}</span>`;
}

export function renderSettings(state, cloud, store) {
  const sync = store.sync;
  const email = cloud.email;
  const cloudBlock = !cloud.configured
    ? `<p class="hint">هذا التطبيق يعمل على هذا الجهاز فقط لأن إعدادات السحابة غير موجودة. أضف رابط Supabase والمفتاح العام في config.js لتفعيل المزامنة. راجع README.</p>`
    : `<p>الحساب: <strong>${esc(email || 'غير مسجّل')}</strong> ${badge(STATUS_TEXT[sync.status]?.[0] || sync.status, STATUS_TEXT[sync.status]?.[1] || '')}</p>
       <p class="hint small">آخر حفظ ناجح: ${esc(localTime(sync.lastSyncedAt) || 'لم يحدث بعد')} · إصدار السحابة: ${sync.serverVersion}</p>
       ${sync.error ? `<p class="warn-text">${esc(sync.error)}</p>` : ''}
       <div class="actions-start">
         <button type="button" class="ghost" data-act="sync-now">مزامنة الآن</button>
         <button type="button" class="ghost danger-text" data-act="logout">تسجيل الخروج ومسح بيانات هذا الجهاز</button>
       </div>`;
  return `
    <article class="card">
      <h3>الإعدادات العامة</h3>
      <form data-form="settings-save" class="form-grid">
        <label>اسم التطبيق (قابل للتعديل)<input name="appName" maxlength="40" required value="${esc(state.settings.appName)}" /></label>
        <label>عملة العرض في التقارير<select name="displayCurrency">${options(state.finance.currencies.map((c) => ({ id: c.code, name: c.code })), state.settings.displayCurrency)}</select></label>
        <label class="wide">رابط مدير كلمات المرور الذي تختاره (اختياري)<input name="passwordManagerUrl" inputmode="url" placeholder="https://" value="${esc(state.settings.passwordManagerUrl)}" /></label>
        <label class="wide">اسم مدير كلمات المرور (للعرض)<input name="passwordManagerLabel" maxlength="60" value="${esc(state.settings.passwordManagerLabel)}" /></label>
        <p class="hint wide">التطبيق لا يتصل بمدير كلمات المرور ولا يعرض كلماتك. الزر مجرد اختصار لفتح الرابط الذي تحدده.</p>
        <div class="wide actions-end"><button class="primary" type="submit">حفظ الإعدادات</button></div>
      </form>
    </article>
    <article class="card">
      <h3>الحفظ السحابي والمزامنة</h3>
      ${cloudBlock}
    </article>
    <article class="card">
      <h3>النسخ الاحتياطي</h3>
      <p class="hint small">الملف يحتوي كل البيانات والمرفقات بصيغة JSON. أي شخص يملك الملف يرى بياناتك، فاحفظه في مكان آمن.</p>
      <div class="actions-start">
        <button type="button" class="primary" data-act="backup-export">تنزيل نسخة احتياطية</button>
        <label class="btn ghost file-btn">استعادة من ملف<input type="file" accept="application/json,.json" data-change="backup-import" hidden /></label>
      </div>
      <p class="hint small">الاستعادة تستبدل كل البيانات الحالية. قبل الاستبدال يُنزَّل تلقائيًا ملف نسخة من الحالية.</p>
    </article>
    <article class="card">
      <h3>عن الحدود</h3>
      <ul class="plain small">
        <li>إصدار البيانات: ${SCHEMA_VERSION}. العملات الافتراضية: ${DEFAULT_CURRENCIES.map((c) => c.code).join('، ')}.</li>
        <li>أسعار الصرف يدخلها المستخدم يدويًا. لا يوجد ربط بالبنوك ولا استيراد ملفات كشوف.</li>
        <li>لا توجد إشعارات في الخلفية. التذكيرات تظهر داخل التطبيق فقط.</li>
      </ul>
    </article>`;
}

export function conflictModal(store) {
  const c = store.sync.conflict;
  const remoteNote = c && c.kind === 'missing_remote'
    ? 'السحابة لا تحتوي نسخة حالية، بينما هذا الجهاز يعرف إصدارًا سابقًا.'
    : 'تم حفظ تعديلات من جهاز آخر بعد آخر مزامنة لهذا الجهاز، وهذا الجهاز فيه تعديلات لم تُرسل.';
  openModal({
    title: 'تعارض بين نسختين',
    body: `<p>${esc(remoteNote)}</p>
      <p class="hint small">لن يُستبدل شيء بصمت. اختر ما تريد، وأي نسخة تُستبعد تُحفظ أولًا كملف احتياطي.</p>
      <ul class="plain small">
        <li><strong>احتفظ بنسخة هذا الجهاز:</strong> تُرسل تعديلات هذا الجهاز وتكتب فوق السحابة. نسخة السحابة تُنزَّل قبل ذلك.</li>
        <li><strong>استخدم نسخة السحابة:</strong> تُحمَّل بيانات السحابة. تعديلات هذا الجهاز تُنزَّل كملف قبل الاستبدال.</li>
      </ul>`,
    footer: `<button type="button" class="ghost" data-act="conflict-later">لاحقًا</button>
      <button type="button" class="ghost" data-act="conflict-download">تنزيل نسخة هذا الجهاز فقط</button>
      <button type="button" class="ghost" data-act="conflict-remote">استخدم نسخة السحابة</button>
      <button type="button" class="primary" data-act="conflict-local">احتفظ بنسخة هذا الجهاز</button>`,
  });
}

export const handlers = {
  acts: {
    'backup-export'() {
      try {
        downloadBackupNow();
        toast('نُزِّلت النسخة الاحتياطية', 'ok');
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    'sync-now'() {
      ctx.store.pull();
    },
    async logout() {
      const dirty = ctx.store.sync.dirty;
      const msg = dirty
        ? 'هناك تعديلات لم تُرسل إلى السحابة بعد. تسجيل الخروج سيمسح نسخة هذا الجهاز. هل تريد تنزيل نسخة احتياطية أولًا؟'
        : 'سيُمسح من هذا الجهاز كل ما هو مخزّن محليًا (البيانات والجلسة). البيانات في السحابة تبقى.';
      const ok = await confirmDialog(msg, dirty ? 'تنزيل ثم الخروج' : 'تسجيل الخروج');
      if (!ok) return;
      if (dirty) downloadBackupNow();
      ctx.store.signOutAndClear();
      toast('تم تسجيل الخروج ومسح البيانات المحلية', 'ok');
    },
    'conflict-local'() {
      closeModal();
      ctx.store.resolveUseLocal().catch((e) => toast(errMsg(e), 'error'));
    },
    async 'conflict-remote'() {
      const ok = await confirmDialog('سيتم تنزيل نسخة احتياطية من تعديلات هذا الجهاز، ثم تحميل نسخة السحابة. متابعة؟', 'متابعة');
      if (!ok) return;
      downloadBackupNow();
      ctx.store.resolveUseRemote().then(() => toast('حُمّلت نسخة السحابة', 'ok')).catch((e) => toast(errMsg(e), 'error'));
      closeModal();
    },
    'conflict-download'() {
      downloadBackupNow();
      toast('نُزِّلت نسخة هذا الجهاز', 'ok');
    },
    'conflict-later'() {
      closeModal();
    },
  },
  forms: {
    'settings-save'(form) {
      const d = formData(form);
      runForm(
        form,
        () =>
          ctx.store.update((s) => {
            const name = String(d.appName || '').trim();
            if (!name) throw new ValidationError('اسم التطبيق مطلوب');
            s.settings.appName = name.slice(0, 40);
            s.settings.passwordManagerUrl = String(d.passwordManagerUrl || '').trim();
            s.settings.passwordManagerLabel = String(d.passwordManagerLabel || '').trim().slice(0, 60) || 'مدير كلمات المرور';
            s.settings.displayCurrency = d.displayCurrency || s.settings.displayCurrency;
            if (s.settings.passwordManagerUrl && !/^https?:\/\//.test(s.settings.passwordManagerUrl)) {
              throw new ValidationError('رابط مدير كلمات المرور يجب أن يبدأ بـ https://');
            }
          }),
        { keepOpen: true, successMessage: 'تم حفظ الإعدادات' },
      );
    },
  },
  changes: {
    async 'backup-import'(el) {
      const file = el.files && el.files[0];
      el.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const state = parseBackup(text);
        const ok = await confirmDialog(
          `ستُستبدل كل البيانات الحالية بالنسخة الموجودة في الملف (${state.plan.levels.length} مستوى، ${state.bank.length} عنصر بنك، ${state.services.length} خدمة). سيُنزَّل ملف نسخة من الحالية أولًا. متابعة؟`,
          'استعادة',
        );
        if (!ok) return;
        downloadBackupNow();
        ctx.store.replaceWithBackup(state);
        toast('تمت الاستعادة', 'ok');
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
  },
};
