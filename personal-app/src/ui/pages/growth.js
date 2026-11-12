import { ctx, ui } from '../ctx.js';
import { esc, pct, badge, options, compressImage, formData } from '../util.js';
import { openModal, toast } from '../modal.js';
import { runForm, runAction } from '../run.js';
import { newId as newIdLocal } from '../../core/state.js';
import {
  addDomain,
  renameDomain,
  deleteDomain,
  addPoint,
  updatePoint,
  addEvaluation,
  pointTrend,
  buildAnalytics,
  SCORE_MIN,
  SCORE_MAX,
} from '../../core/growth.js';
import { todayISO } from '../../core/dates.js';

const TABS = [
  ['profile', 'الملف الشخصي'],
  ['points', 'المجالات والنقاط'],
  ['analytics', 'التحليلات'],
  ['history', 'السجل'],
];

const SCORE_OPTIONS = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);

function trendText(t) {
  if (!t.hasLaterEvaluation) return { text: 'تقييم واحد فقط', tone: '' };
  if (t.change > 0) return { text: `تحسّن +${t.change}`, tone: 'good' };
  if (t.change < 0) return { text: `تراجع ${t.change}`, tone: 'warn' };
  return { text: 'بلا تغيير', tone: '' };
}

function avatarHtml(profile) {
  if (profile.avatar) return `<img class="avatar" src="${esc(profile.avatar)}" alt="صورة الملف الشخصي" />`;
  const initial = esc((profile.name || 'ت').trim().charAt(0) || 'ت');
  return `<div class="avatar placeholder" aria-hidden="true">${initial}</div>`;
}

function profileView(state) {
  const p = state.profile;
  return `
    <article class="card profile-card">
      <div class="profile-head">
        ${avatarHtml(p)}
        <div class="profile-actions">
          <label class="btn ghost file-btn">
            ${p.avatar ? 'تغيير الصورة' : 'رفع صورة'}
            <input type="file" accept="image/*" data-change="avatar-upload" hidden />
          </label>
          ${p.avatar ? '<button type="button" class="ghost danger-text" data-act="avatar-remove">حذف الصورة</button>' : ''}
        </div>
      </div>
      <form data-form="profile-save" class="form-grid">
        <label>الاسم<input name="name" maxlength="80" value="${esc(p.name)}" /></label>
        <label class="wide">نبذة عني<textarea name="bio" rows="3" maxlength="500">${esc(p.bio)}</textarea></label>
        <label>المدينة (اختياري)<input name="city" maxlength="60" value="${esc(p.city)}" /></label>
        <label>المهنة (اختياري)<input name="occupation" maxlength="60" value="${esc(p.occupation)}" /></label>
        <p class="hint wide">كل الحقول اختيارية. لا يطلب التطبيق بيانات حساسة مثل الرقم القومي أو الهوية.</p>
        <div class="wide actions-end"><button class="primary" type="submit">حفظ الملف</button></div>
      </form>
    </article>`;
}

function domainsView(state) {
  const domains = state.growth.domains;
  const chips = domains.length
    ? domains
        .map(
          (d) => `<span class="chip">${esc(d.name)}
            <button type="button" class="chip-btn" data-act="domain-rename" data-id="${esc(d.id)}" aria-label="إعادة تسمية ${esc(d.name)}">✎</button>
            <button type="button" class="chip-btn" data-act="domain-delete" data-id="${esc(d.id)}" aria-label="حذف ${esc(d.name)}">✕</button></span>`,
        )
        .join('')
    : '<p class="hint">لا توجد مجالات بعد. أضف مجالاتك مثل: الدراسة، العمل، اللغة، اللياقة.</p>';
  return `
    <article class="card">
      <h3>مجالاتي</h3>
      <div class="chips">${chips}</div>
      <form data-form="domain-add" class="inline-form">
        <input name="name" maxlength="60" placeholder="اسم المجال الجديد" required />
        <button class="ghost" type="submit">إضافة مجال</button>
      </form>
    </article>`;
}

function pointRow(state, p) {
  const t = pointTrend(p);
  const tr = trendText(t);
  const domain = state.growth.domains.find((d) => d.id === p.domainId);
  const last = p.evaluations[p.evaluations.length - 1];
  return `
    <li class="point-row ${p.archived ? 'muted' : ''}">
      <div class="point-main">
        <strong>${esc(p.name)}</strong>
        <span class="hint">${esc(domain?.name || 'بدون مجال')}</span>
        ${p.description ? `<p class="hint">${esc(p.description)}</p>` : ''}
      </div>
      <div class="point-score">
        <span>أولي: <b>${t.initial}</b></span>
        <span>آخر: <b>${t.latest}</b> <small class="hint">(${esc(last.date)})</small></span>
        ${badge(tr.text, tr.tone)}
      </div>
      <div class="point-actions">
        ${p.archived ? '' : `<button type="button" class="ghost" data-act="eval-open" data-id="${esc(p.id)}">+ تقييم</button>`}
        <button type="button" class="ghost" data-act="point-archive" data-id="${esc(p.id)}" data-archived="${p.archived ? '0' : '1'}">${p.archived ? 'إعادة تفعيل' : 'أرشفة'}</button>
      </div>
    </li>`;
}

function pointsView(state) {
  const strengths = state.growth.points.filter((p) => p.kind === 'strength');
  const weaknesses = state.growth.points.filter((p) => p.kind === 'weakness');
  const group = (title, list, kind) => `
    <article class="card">
      <div class="card-head"><h3>${title}</h3>
        <button type="button" class="ghost" data-act="point-open-add" data-kind="${kind}">+ إضافة</button></div>
      ${list.length ? `<ul class="points">${list.map((p) => pointRow(state, p)).join('')}</ul>` : `<p class="hint">لا توجد عناصر بعد.</p>`}
    </article>`;
  return `
    ${domainsView(state)}
    ${group('نقاط القوة التي أريد تعزيزها', strengths, 'strength')}
    ${group('نقاط الضعف التي أريد تحسينها', weaknesses, 'weakness')}
    <p class="hint">الدرجة الأعلى تعني وضعًا أفضل، سواء كانت النقطة قوة أو ضعفًا. تقييم الدرجة تقدير ذاتي، وليس نتيجة مهام مكتملة.</p>`;
}

function analyticsView(state) {
  const a = buildAnalytics(state);
  const lv = a.levels;
  const cur = lv.current;
  const domainsRows = a.byDomain.length
    ? a.byDomain.map((d) => `<li><span>${esc(d.name)}</span><b>${d.count}</b></li>`).join('')
    : '<li class="hint">لا توجد تحديات مكتملة في مستويات مكتملة بعد.</li>';
  const pointRows = a.byPoint.length
    ? a.byPoint.map((p) => `<li><span>${esc(p.name)}</span><b>${p.count}</b></li>`).join('')
    : '<li class="hint">لا توجد إنجازات مرتبطة بنقاط بعد.</li>';
  const trendRows = a.points.length
    ? a.points
        .map((p) => {
          const tr = trendText(p);
          return `<tr><td>${esc(p.name)}</td><td>${p.kind === 'strength' ? 'قوة' : 'ضعف'}</td><td>${p.initial}</td><td>${p.latest}</td><td>${badge(tr.text, tr.tone)}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="5" class="hint">لا توجد نقاط بعد.</td></tr>';
  const stoppedRows = a.stopped.length
    ? a.stopped.map((s) => `<li><strong>${esc(s.title)}</strong> <span class="hint">في ${esc(s.levelName)}${s.reason ? ` — ${esc(s.reason)}` : ''}</span></li>`).join('')
    : '<li class="hint">لا توجد تحديات متوقفة.</li>';
  const replacedRows = a.replaced.length
    ? a.replaced.map((r) => `<li><strong>${esc(r.title)}</strong> <span class="hint">بتقدم ${pct(r.progress)} — السبب: ${esc(r.reason)}</span></li>`).join('')
    : '<li class="hint">لا توجد تحديات مستبدلة.</li>';
  const levelsRows = a.completedLevels.length
    ? a.completedLevels.map((l) => `<li>${l.order}. ${esc(l.name)} <span class="hint">${esc((l.completedAt || '').slice(0, 10))}</span></li>`).join('')
    : '<li class="hint">لم يكتمل أي مستوى بعد. هذه قائمة فارغة وليست خللًا.</li>';

  return `
    <article class="card kpis">
      <div class="kpi"><span>المستوى الحالي</span><b>${esc(cur ? cur.name : 'لا يوجد')}</b>${cur ? `<small>التقدم ${pct(cur.progress)}${cur.complete ? ' · جاهز للإكمال' : ''}</small>` : ''}</div>
      <div class="kpi"><span>المكتملة / المستهدف</span><b>${lv.completed} / ${lv.target}</b><small>المجهز فعليًا: ${lv.prepared}</small></div>
      <div class="kpi"><span>نسبة الرحلة</span><b>${pct(lv.journeyPercent / 100)}</b><small>من المستويات المكتملة فقط</small></div>
      <div class="kpi"><span>تحديات مكتملة موثّقة</span><b>${a.completedChallengeCount}</b><small>من المستويات المكتملة</small></div>
    </article>
    <article class="card">
      <h3>إكمال المهام مقابل التقييم الذاتي</h3>
      <p class="hint">إكمال التحديات يُعرض منفصلًا عن التقييم. إنجاز المهام لا يثبت وحده تحسن السمة؛ قارن الدرجات بتقييمك الذاتي.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>النقطة</th><th>النوع</th><th>الأولي</th><th>الآن</th><th>الاتجاه</th></tr></thead>
        <tbody>${trendRows}</tbody>
      </table></div>
    </article>
    <div class="two-col">
      <article class="card"><h3>الإنجازات حسب المجال</h3><ul class="plain">${domainsRows}</ul></article>
      <article class="card"><h3>الإنجازات حسب نقطة التطوير</h3><ul class="plain">${pointRows}</ul></article>
    </div>
    <div class="two-col">
      <article class="card"><h3>المستويات المكتملة</h3><ul class="plain">${levelsRows}</ul></article>
      <article class="card"><h3>التحديات المتوقفة</h3><ul class="plain">${stoppedRows}</ul></article>
    </div>
    <article class="card"><h3>التحديات المستبدلة وأسبابها</h3><ul class="plain">${replacedRows}</ul></article>
    <p class="hint">مستوى الإكمال وأرقام المستويات تأتي من المستويات المكتملة فقط. المستويات التي تغير عدد المستهدف لا تمحو أي إنجاز سابق.</p>`;
}

function historyView(state) {
  const a = buildAnalytics(state);
  const awards = a.awards.length
    ? a.awards.map((w) => `<li>${w.kind === 'badge' ? `${esc(w.icon)} شارة` : '🎁 مكافأة'}: <strong>${esc(w.title)}</strong> <span class="hint">${esc((w.awardedAt || '').slice(0, 10))}</span></li>`).join('')
    : '<li class="hint">لا توجد مكافآت أو شارات بعد.</li>';
  const log = a.log.length
    ? a.log.map((e) => `<li><span class="hint">${esc((e.at || '').slice(0, 10))}</span> ${esc(e.text)}</li>`).join('')
    : '<li class="hint">السجل فارغ.</li>';
  return `
    <article class="card"><h3>المكافآت والشارات</h3><ul class="plain">${awards}</ul></article>
    <article class="card"><h3>سجل التغييرات المهمة</h3><ul class="plain log">${log}</ul></article>`;
}

export function renderGrowth(state) {
  const tabs = `<nav class="tabs" role="tablist" aria-label="أقسام تطوّري">${TABS.map(
    ([id, label]) =>
      `<button type="button" role="tab" aria-selected="${ui.growthTab === id}" class="tab ${ui.growthTab === id ? 'active' : ''}" data-act="growth-tab" data-tab="${id}">${label}</button>`,
  ).join('')}</nav>`;
  const body = {
    profile: () => profileView(state),
    points: () => pointsView(state),
    analytics: () => analyticsView(state),
    history: () => historyView(state),
  }[ui.growthTab]();
  return `${tabs}<section class="stack">${body}</section>`;
}

function pointForm(kind, state, point = null) {
  const domains = options(state.growth.domains, point?.domainId, { empty: 'بدون مجال' });
  return `
    <form data-form="point-add" class="form-grid">
      <label>النوع<select name="kind">
        <option value="strength" ${kind === 'strength' ? 'selected' : ''}>نقطة قوة أريد تعزيزها</option>
        <option value="weakness" ${kind === 'weakness' ? 'selected' : ''}>نقطة ضعف أريد تحسينها</option>
      </select></label>
      <label>المجال<select name="domainId">${domains}</select></label>
      <label class="wide">الاسم<input name="name" maxlength="120" required placeholder="مثال: الالتزام بالمراجعة الأسبوعية" /></label>
      <label class="wide">الوصف (اختياري)<textarea name="description" rows="2" maxlength="1000"></textarea></label>
      <label>التقييم الأولي (${SCORE_MIN} إلى ${SCORE_MAX})<select name="initialScore">${SCORE_OPTIONS.map((n) => `<option value="${n}" ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>تاريخ التقييم<input name="date" type="date" value="${todayISO()}" required /></label>
      <label class="wide">ملاحظة (اختياري)<input name="note" maxlength="500" /></label>
      <p class="hint wide">الدرجة الأعلى = وضع أفضل. هذا التقييم الأولي لا يُحذف، والتقييمات اللاحقة تُقارن به.</p>
      <div class="wide actions-end"><button class="primary" type="submit">حفظ النقطة</button></div>
    </form>`;
}

export const handlers = {
  acts: {
    'growth-tab'(el) {
      ui.growthTab = el.dataset.tab;
      return true;
    },
    'domain-rename'(el) {
      const dom = ctx.store.state.growth.domains.find((d) => d.id === el.dataset.id);
      const name = window.prompt('الاسم الجديد للمجال', dom?.name || '');
      if (name === null) return;
      runAction(() => ctx.store.update((d) => renameDomain(d, el.dataset.id, name)), 'تمت إعادة التسمية');
      return true;
    },
    'domain-delete'(el) {
      runAction(() => ctx.store.update((d) => deleteDomain(d, el.dataset.id)), 'تم حذف المجال');
      return true;
    },
    'avatar-remove'() {
      runAction(() => ctx.store.update((d) => { d.profile.avatar = null; }), 'تم حذف الصورة');
      return true;
    },
    'point-open-add'(el) {
      openModal({ title: 'إضافة نقطة تطوير', body: pointForm(el.dataset.kind, ctx.store.state), wide: true });
    },
    'eval-open'(el) {
      const p = ctx.store.state.growth.points.find((x) => x.id === el.dataset.id);
      if (!p) return;
      openModal({
        title: `تقييم جديد: ${p.name}`,
        body: `
          <p class="hint">التقييم الأولي: <b>${p.evaluations[0].score}</b> — آخر تقييم: <b>${p.evaluations[p.evaluations.length - 1].score}</b></p>
          <form data-form="eval-add" class="form-grid">
            <input type="hidden" name="pointId" value="${esc(p.id)}" />
            <label>الدرجة<select name="score">${SCORE_OPTIONS.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
            <label>التاريخ<input name="date" type="date" value="${todayISO()}" required /></label>
            <label class="wide">ملاحظة (اختياري)<input name="note" maxlength="500" /></label>
            <div class="wide actions-end"><button class="primary" type="submit">حفظ التقييم</button></div>
          </form>`,
      });
    },
    'point-archive'(el) {
      runAction(
        () => ctx.store.update((d) => updatePoint(d, el.dataset.id, { archived: el.dataset.archived === '1' })),
        el.dataset.archived === '1' ? 'أُرشفت النقطة. تبقى تقييماتها محفوظة.' : 'أُعيد تفعيل النقطة',
      );
      return true;
    },
  },
  forms: {
    'profile-save'(form) {
      const d = formData(form);
      runForm(
        form,
        () =>
          ctx.store.update((s) => {
            s.profile.name = String(d.name || '').trim().slice(0, 80);
            s.profile.bio = String(d.bio || '').trim().slice(0, 500);
            s.profile.city = String(d.city || '').trim().slice(0, 60);
            s.profile.occupation = String(d.occupation || '').trim().slice(0, 60);
          }),
        { keepOpen: true, successMessage: 'تم حفظ الملف الشخصي' },
      );
    },
    'domain-add'(form) {
      const d = formData(form);
      const ok = runForm(
        form,
        () => ctx.store.update((s) => addDomain(s, d.name, newIdLocal)),
        { keepOpen: true, successMessage: 'تمت إضافة المجال' },
      );
      if (ok) form.reset();
    },
    'point-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          addPoint(
            s,
            { kind: d.kind, name: d.name, description: d.description, domainId: d.domainId, initialScore: d.initialScore, date: d.date, note: d.note },
            newIdLocal,
          ),
        ),
      );
    },
    'eval-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => addEvaluation(s, d.pointId, { date: d.date, score: d.score, note: d.note }, newIdLocal)),
      );
    },
  },
  changes: {
    async 'avatar-upload'(el) {
      const file = el.files && el.files[0];
      if (!file) return;
      try {
        const dataUrl = await compressImage(file, 256, 0.85);
        ctx.store.update((s) => {
          s.profile.avatar = dataUrl;
        });
        toast('تم تحديث الصورة', 'ok');
      } catch (e) {
        toast(e.message || 'تعذر رفع الصورة', 'error');
      }
    },
  },
};

