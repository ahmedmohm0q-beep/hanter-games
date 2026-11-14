import { ctx, ui } from '../ctx.js';
import { esc, pct, bar, badge, options, parseLines, formData, emptyState } from '../util.js';
import { openModal, toast, confirmDialog, closeModal } from '../modal.js';
import { runForm, runAction, errMsg } from '../run.js';
import { newId } from '../../core/state.js';
import {
  addLevel,
  updateLevelMeta,
  deleteUpcomingLevel,
  moveUpcomingLevel,
  setTargetLevels,
  addChallenge,
  updateChallengeDef,
  addSubtask,
  stopChallenge,
  resumeChallenge,
  replaceChallenge,
  removeChallenge,
  previewPlanChange,
  instantiateFromBank,
  sortedLevels,
  completedLevels,
  findLevel,
} from '../../core/plan.js';
import { challengeProgress, isLevelPrepared, activeChallenges } from '../../core/levels.js';
import { filterBank, BANK_TYPES } from '../../core/bank.js';
import { ValidationError } from '../../core/money.js';

const TYPE_LABEL = { binary: 'ثنائي', numeric: 'رقمي', composite: 'مركّب' };
const STATUS_LABEL = { current: 'الحالي', upcoming: 'قادم', completed: 'مكتمل' };

function parseSubtaskLines(text) {
  return parseLines(text).map((line) => {
    const p = line.split('|').map((x) => x.trim());
    if (p[1] === 'numeric') return { title: p[0], type: 'numeric', target: Number(p[2]), weight: p[3] ? Number(p[3]) : 1 };
    return { title: p[0], type: 'binary', weight: p[2] ? Number(p[2]) : 1 };
  });
}

function challengeFields(state, ch = null) {
  const v = ch || { type: 'binary', weight: 1, title: '', description: '', target: '', unit: '', domainId: null, pointId: null, successCriteria: [] };
  const points = state.growth.points.filter((p) => !p.archived);
  return `
    <label class="wide">العنوان<input name="title" maxlength="200" required value="${esc(v.title)}" /></label>
    <label class="wide">الوصف (اختياري)<textarea name="description" rows="2" maxlength="1000">${esc(v.description || '')}</textarea></label>
    ${ch ? '' : `<label>النوع<select name="type">
        <option value="binary" ${v.type === 'binary' ? 'selected' : ''}>ثنائي: تم أو لم يتم</option>
        <option value="numeric" ${v.type === 'numeric' ? 'selected' : ''}>رقمي: هدف بالأرقام</option>
        <option value="composite" ${v.type === 'composite' ? 'selected' : ''}>مركّب: مهام صغيرة</option>
      </select></label>`}
    ${ch && ch.type === 'numeric' ? `<label>الهدف الرقمي<input name="target" inputmode="decimal" value="${esc(v.target)}" /></label>` : ''}
    ${ch ? '' : `<label>الهدف الرقمي (للرقمي فقط)<input name="target" inputmode="decimal" /></label>`}
    <label>الوحدة (اختياري)<input name="unit" maxlength="40" value="${esc(v.unit || '')}" /></label>
    <label>وزن التحدي داخل المستوى (أكبر من صفر)<input name="weight" inputmode="decimal" value="${esc(v.weight)}" /></label>
    <label>المجال<select name="domainId">${options(state.growth.domains, v.domainId, { empty: 'بدون مجال' })}</select></label>
    <label>نقطة التطوير<select name="pointId">${options(points, v.pointId, { empty: 'بدون نقطة' })}</select></label>
    ${ch ? '' : `<label class="wide">المهام الصغيرة للمركّب (سطر لكل مهمة: عنوان | binary | وزن، أو عنوان | numeric | هدف | وزن)<textarea name="subtasks" rows="3"></textarea></label>`}
    <label class="wide">شروط النجاح (سطر لكل شرط)<textarea name="successCriteria" rows="2">${esc((v.successCriteria || []).join('\n'))}</textarea></label>`;
}

function challengeRow(level, ch, locked, state) {
  const prog = challengeProgress(ch);
  const isStopped = ch.status === 'stopped';
  const dom = state.growth.domains.find((d) => d.id === ch.domainId);
  const subs = (ch.subtasks || []).map((s) => `<li>${esc(s.title)} <span class="hint">· وزن ${s.weight}${s.type === 'numeric' ? ` · هدف ${s.target}` : ''}</span></li>`).join('');
  return `
    <li class="ch-row ${isStopped ? 'stopped' : ''}">
      <div class="ch-head">
        <strong>${esc(ch.title)}</strong>
        <div class="tags">${badge(TYPE_LABEL[ch.type])} ${badge(`وزن ${ch.weight}`)} ${dom ? badge(dom.name) : ''} ${isStopped ? badge('متوقف', 'warn') : ''}</div>
      </div>
      ${ch.type === 'composite' ? `<ul class="plain small">${subs || '<li class="hint">بلا مهام بعد؛ لن يكتمل التحدي قبل إضافة مهمة.</li>'}</ul>` : `<p class="hint small">${ch.type === 'numeric' ? `الهدف ${ch.target}${ch.unit ? ' ' + esc(ch.unit) : ''}` : 'ثنائي'}</p>`}
      ${bar(prog, ch.title)}
      <div class="ch-actions">
        ${locked ? '' : `<button type="button" class="ghost" data-act="ch-edit" data-level="${esc(level.id)}" data-id="${esc(ch.id)}">تعديل</button>`}
        ${locked || ch.type !== 'composite' ? '' : `<button type="button" class="ghost" data-act="sub-open" data-level="${esc(level.id)}" data-id="${esc(ch.id)}">+ مهمة</button>`}
        ${locked ? '' : `<button type="button" class="ghost" data-act="ch-replace-open" data-level="${esc(level.id)}" data-id="${esc(ch.id)}">استبدال بسبب</button>`}
        ${locked ? '' : `<button type="button" class="ghost" data-act="ch-stop-open" data-level="${esc(level.id)}" data-id="${esc(ch.id)}" data-stopped="${isStopped ? '1' : '0'}">${isStopped ? 'استئناف' : 'إيقاف بسبب'}</button>`}
        ${locked ? '' : `<button type="button" class="ghost danger-text" data-act="ch-remove" data-level="${esc(level.id)}" data-id="${esc(ch.id)}">حذف</button>`}
      </div>
    </li>`;
}

function levelCard(state, level, idx, total) {
  const locked = level.status === 'completed';
  const open = Boolean(ui.journeyExpanded[level.id]);
  const active = activeChallenges(level);
  const prepared = isLevelPrepared(level);
  const reward = level.reward ? `🎁 ${esc(level.reward.title)}` : 'بلا مكافأة';
  const badgeTxt = level.badge ? `${esc(level.badge.icon || '')} ${esc(level.badge.name)}` : 'بلا شارة';
  const status = level.status;
  return `
    <li class="level-card ${status}">
      <header class="level-head">
        <div>
          <span class="chip-status ${status}">${STATUS_LABEL[status]}</span>
          <strong class="level-name">${level.order}. ${esc(level.name)}</strong>
          ${prepared ? '' : badge('غير مجهز: يحتاج تحديًا واحدًا على الأقل', 'warn')}
        </div>
        <button type="button" class="ghost" data-act="level-toggle" data-id="${esc(level.id)}" aria-expanded="${open}">${open ? 'إخفاء التفاصيل' : 'التفاصيل'}</button>
      </header>
      <p class="hint small">${active.length} تحدٍّ نشط · ${reward} · ${badgeTxt}</p>
      ${level.description ? `<p class="small">${esc(level.description)}</p>` : ''}
      ${status === 'completed' ? `<p class="hint small">اكتمل في ${esc((level.completedAt || '').slice(0, 10))} — نسخة ثابتة محفوظة.</p>` : ''}
      ${open
        ? `<div class="level-body">
            <ul class="plain">${(level.challenges || []).filter((c) => c.status !== 'replaced').map((c) => challengeRow(level, c, locked, state)).join('') || '<li class="hint">لا توجد تحديات بعد.</li>'}</ul>
            ${(level.challenges || []).some((c) => c.status === 'replaced')
              ? `<details><summary>التحديات المستبدلة (${level.challenges.filter((c) => c.status === 'replaced').length})</summary><ul class="plain small">${level.challenges
                  .filter((c) => c.status === 'replaced')
                  .map((c) => `<li>${esc(c.title)} — بتقدم ${pct(challengeProgress(c))} — ${esc(c.replaceReason || '')}</li>`)
                  .join('')}</ul></details>`
              : ''}
            <div class="ch-actions">
              ${locked ? '' : `<button type="button" class="primary" data-act="ch-add-open" data-level="${esc(level.id)}">+ تحدٍّ جديد</button>
              <button type="button" class="ghost" data-act="ch-from-bank-open" data-level="${esc(level.id)}">من البنك</button>
              <button type="button" class="ghost" data-act="level-edit" data-id="${esc(level.id)}">تعديل الاسم والمكافأة</button>`}
              ${status === 'upcoming' ? `<button type="button" class="ghost" data-act="level-move" data-id="${esc(level.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="ghost" data-act="level-move" data-id="${esc(level.id)}" data-dir="1" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
              ${level.challenges.length === 0 ? `<button type="button" class="ghost danger-text" data-act="level-delete" data-id="${esc(level.id)}">حذف المستوى</button>` : ''}` : ''}
            </div>
          </div>`
        : ''}
    </li>`;
}

export function renderJourney(state) {
  const levels = sortedLevels(state);
  const done = completedLevels(state).length;
  const prepared = levels.filter(isLevelPrepared).length;
  const target = state.plan.targetLevels;
  return `
    <article class="card">
      <div class="card-head"><h3>الهدف والتجهيز</h3></div>
      <div class="kpis">
        <div class="kpi"><span>المستهدف</span><b>${target}</b><small>عدد المستويات في الرحلة</small></div>
        <div class="kpi"><span>المجهز فعليًا</span><b>${prepared}</b><small>مستويات بتحدٍّ نشط على الأقل</small></div>
        <div class="kpi"><span>المكتمل</span><b>${done}</b><small>محفوظة بنسخها الأصلية</small></div>
      </div>
      <form data-form="target-save" class="inline-form">
        <label class="grow">عدد المستويات المستهدف<input name="target" inputmode="numeric" value="${target}" /></label>
        <button class="ghost" type="submit">حفظ الهدف</button>
      </form>
      <p class="hint">المستهدف رقم تخطيطي وقابل للتغيير. تقليله لا يحذف أي مستوى، ولا ينزل عن عدد المستويات المكتملة.</p>
    </article>
    <article class="card">
      <h3>إضافة مستوى</h3>
      <form data-form="level-add" class="form-grid">
        <label>اسم المستوى<input name="name" maxlength="120" required /></label>
        <label>المكافأة (اختياري)<input name="rewardTitle" maxlength="200" placeholder="مثال: عشاء خارج البيت" /></label>
        <label class="wide">وصف المستوى<textarea name="description" rows="2" maxlength="1000"></textarea></label>
        <label>ملاحظة المكافأة<input name="rewardNote" maxlength="500" /></label>
        <label>الشارة (اسم)<input name="badgeName" maxlength="100" /></label>
        <label>رمز الشارة<input name="badgeIcon" maxlength="8" placeholder="🏅" /></label>
        <div class="wide actions-end"><button class="primary" type="submit">إضافة المستوى</button></div>
      </form>
      <p class="hint">المكافأة والشارة تُسجَّلان تلقائيًا عند إكمال المستوى، دون تأكيد منفصل. أي نشاط تكافئ به نفسك يبقى خارج التطبيق.</p>
    </article>
    ${levels.length
      ? `<ol class="levels">${levels.map((l, i) => levelCard(state, l, i, levels.length)).join('')}</ol>`
      : emptyState('لا توجد مستويات بعد', 'ابدأ بإضافة أول مستوى، ثم أضف إليه تحديًا أو أكثر.')}`;
}

function previewHtml(p) {
  const row = (label, a, b) => `<tr><th>${label}</th><td>${esc(a ?? '—')}</td><td>${esc(b ?? '—')}</td></tr>`;
  return `
    <table class="preview">
      <thead><tr><th></th><th>قبل</th><th>بعد</th></tr></thead>
      <tbody>
        ${row('المستوى الحالي', p.before.currentName, p.after.currentName)}
        ${row('التقدم', p.before.progress === null ? '—' : pct(p.before.progress), p.after.progress === null ? '—' : pct(p.after.progress))}
        ${row('المستويات المكتملة', p.before.completedCount, p.after.completedCount)}
      </tbody>
    </table>
    ${p.after.completedCount > p.before.completedCount ? '<p class="warn-text">هذا التعديل سيكمل المستوى الحالي ويفتح التالي.</p>' : ''}`;
}

export const handlers = {
  acts: {
    'level-toggle'(el) {
      ui.journeyExpanded[el.dataset.id] = !ui.journeyExpanded[el.dataset.id];
    },
    'level-edit'(el) {
      const lv = findLevel(ctx.store.state, el.dataset.id);
      openModal({
        title: 'تعديل المستوى',
        body: `<form data-form="level-save" data-id="${esc(lv.id)}" class="form-grid">
          <label>الاسم<input name="name" maxlength="120" required value="${esc(lv.name)}" /></label>
          <label>المكافأة<input name="rewardTitle" maxlength="200" value="${esc(lv.reward?.title || '')}" /></label>
          <label class="wide">الوصف<textarea name="description" rows="2" maxlength="1000">${esc(lv.description)}</textarea></label>
          <label>ملاحظة المكافأة<input name="rewardNote" maxlength="500" value="${esc(lv.reward?.note || '')}" /></label>
          <label>الشارة<input name="badgeName" maxlength="100" value="${esc(lv.badge?.name || '')}" /></label>
          <label>رمز الشارة<input name="badgeIcon" maxlength="8" value="${esc(lv.badge?.icon || '')}" /></label>
          <label class="wide">روابط ومصادر (سطر: اسم | https://...)<textarea name="links" rows="2">${esc((lv.links || []).map((l) => `${l.label} | ${l.url}`).join('\n'))}</textarea></label>
          <div class="wide actions-end"><button class="primary" type="submit">حفظ</button></div></form>`,
      });
    },
    'level-move'(el) {
      runAction(() => ctx.store.update((s) => moveUpcomingLevel(s, el.dataset.id, Number(el.dataset.dir))));
    },
    async 'level-delete'(el) {
      const ok = await confirmDialog('حذف هذا المستوى القادم؟ لا يمكن التراجع.', 'حذف');
      if (!ok) return;
      runAction(() => ctx.store.update((s) => deleteUpcomingLevel(s, el.dataset.id)), 'تم حذف المستوى');
    },
    'ch-add-open'(el) {
      openModal({
        title: 'تحدٍّ جديد',
        wide: true,
        body: `<form data-form="ch-add" data-level="${esc(el.dataset.level)}" class="form-grid">${challengeFields(ctx.store.state)}
          <div class="wide actions-end"><button class="primary" type="submit">إضافة التحدي</button></div></form>`,
      });
    },
    'ch-from-bank-open'(el) {
      const items = filterBank(ctx.store.state.bank, { showArchived: false }).filter((b) => b.type !== 'big_goal');
      if (items.length === 0) {
        toast('البنك لا يحتوي عناصر مناسبة بعد', 'error');
        return;
      }
      openModal({
        title: 'إضافة من البنك',
        body: `<form data-form="journey-bank-add" class="form-grid">
          <input type="hidden" name="levelId" value="${esc(el.dataset.level)}" />
          <label class="wide">العنصر<select name="bankId">${items.map((b) => `<option value="${esc(b.id)}">${esc(b.title)} — ${esc(BANK_TYPES[b.type] || b.type)}</option>`).join('')}</select></label>
          <p class="hint wide">ينشئ نسخة مستقلة في المستوى، ولا يغيّر البنك أو أي مستوى آخر.</p>
          <div class="wide actions-end"><button class="primary" type="submit">إضافة</button></div></form>`,
      });
    },
    'ch-edit'(el) {
      const s = ctx.store.state;
      const lv = findLevel(s, el.dataset.level);
      const ch = lv.challenges.find((c) => c.id === el.dataset.id);
      if (!ch) return;
      openModal({
        title: 'تعديل التحدي',
        wide: true,
        body: `<form data-form="ch-save" data-level="${esc(lv.id)}" data-id="${esc(ch.id)}" class="form-grid">${challengeFields(s, ch)}
          <p class="hint wide">${lv.status === 'current' ? 'تعديل الوزن أو الهدف هنا يعرض أثره قبل الحفظ.' : 'التعديل يُحفظ مباشرة لأن المستوى قادم.'}</p>
          <div class="wide actions-end"><button class="primary" type="submit">متابعة</button></div></form>`,
      });
    },
    'sub-open'(el) {
      openModal({
        title: 'مهمة صغيرة جديدة',
        body: `<form data-form="sub-add" data-level="${esc(el.dataset.level)}" data-id="${esc(el.dataset.id)}" class="form-grid">
          <label class="wide">العنوان<input name="title" maxlength="200" required /></label>
          <label>النوع<select name="type"><option value="binary">ثنائي</option><option value="numeric">رقمي</option></select></label>
          <label>الهدف الرقمي<input name="target" inputmode="decimal" /></label>
          <label>الوزن<input name="weight" inputmode="decimal" value="1" /></label>
          <div class="wide actions-end"><button class="primary" type="submit">إضافة</button></div></form>`,
      });
    },
    'ch-stop-open'(el) {
      if (el.dataset.stopped === '1') {
        runAction(() => ctx.store.update((s) => resumeChallenge(s, el.dataset.level, el.dataset.id)), 'استُؤنف التحدي');
        return;
      }
      openModal({
        title: 'إيقاف التحدي',
        body: `<form data-form="ch-stop" data-level="${esc(el.dataset.level)}" data-id="${esc(el.dataset.id)}" class="form-grid">
          <label class="wide">السبب (اختياري)<textarea name="reason" rows="2" maxlength="500"></textarea></label>
          <p class="hint wide">التحدي المتوقف يبقى غير مكتمل، ويمنع إكمال المستوى حتى تستأنفه أو تستبدله.</p>
          <div class="wide actions-end"><button class="primary" type="submit">إيقاف</button></div></form>`,
      });
    },
    'ch-replace-open'(el) {
      const s = ctx.store.state;
      openModal({
        title: 'استبدال التحدي',
        wide: true,
        body: `<form data-form="ch-replace" data-level="${esc(el.dataset.level)}" data-id="${esc(el.dataset.id)}" class="form-grid">
          <label class="wide">سبب الاستبدال (مطلوب)<textarea name="reason" rows="2" maxlength="500" required></textarea></label>
          <p class="hint wide">التحدي القديم يبقى في السجل بتقدمه وسببه، والبديل يبدأ من الصفر.</p>
          <label class="wide">العنوان<input name="title" maxlength="200" required /></label>
          <label>النوع<select name="type"><option value="binary">ثنائي</option><option value="numeric">رقمي</option></select></label>
          <label>الهدف الرقمي<input name="target" inputmode="decimal" /></label>
          <label>الوزن<input name="weight" inputmode="decimal" value="1" /></label>
          <label>المجال<select name="domainId">${options(s.growth.domains, null, { empty: 'بدون مجال' })}</select></label>
          <div class="wide actions-end"><button class="primary" type="submit">استبدال</button></div></form>`,
      });
    },
    async 'ch-remove'(el) {
      const ok = await confirmDialog('حذف هذا التحدي من المستوى؟ يُحذف فقط إذا لم يكن له تقدم.', 'حذف');
      if (!ok) return;
      runAction(() => ctx.store.update((s) => removeChallenge(s, el.dataset.level, el.dataset.id)), 'تم الحذف');
    },
  },
  forms: {
    'target-save'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => setTargetLevels(s, d.target)), { keepOpen: true, successMessage: 'تم حفظ الهدف' });
    },
    'level-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          addLevel(
            s,
            {
              name: d.name,
              description: d.description,
              reward: { title: d.rewardTitle, note: d.rewardNote },
              badge: { name: d.badgeName, icon: d.badgeIcon },
            },
            newId,
          ),
        ),
        { successMessage: 'أُضيف المستوى' },
      );
    },
    'level-save'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          updateLevelMeta(s, form.dataset.id, {
            name: d.name,
            description: d.description,
            reward: { title: d.rewardTitle, note: d.rewardNote },
            badge: { name: d.badgeName, icon: d.badgeIcon },
            links: parseLinksLines(d.links),
          }),
        ),
      );
    },
    'ch-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          addChallenge(
            s,
            form.dataset.level,
            {
              title: d.title,
              description: d.description,
              type: d.type,
              target: d.target,
              unit: d.unit,
              weight: d.weight,
              domainId: d.domainId || null,
              pointId: d.pointId || null,
              subtasks: d.type === 'composite' ? parseSubtaskLines(d.subtasks) : [],
              successCriteria: parseLines(d.successCriteria),
            },
            newId,
          ),
        ),
      );
    },
    'journey-bank-add'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => instantiateFromBank(s, d.bankId, d.levelId, newId)), { successMessage: 'أُضيف إلى المستوى' });
    },
    'ch-save'(form) {
      const d = formData(form);
      const lvId = form.dataset.level;
      const chId = form.dataset.id;
      const patch = {
        title: d.title,
        description: d.description,
        unit: d.unit,
        weight: d.weight,
        domainId: d.domainId || null,
        pointId: d.pointId || null,
        successCriteria: parseLines(d.successCriteria),
      };
      if (d.target !== undefined) patch.target = d.target;
      const lv = findLevel(ctx.store.state, lvId);
      if (lv.status === 'current') {
        try {
          const preview = previewPlanChange(ctx.store.state, (x) => updateChallengeDef(x, lvId, chId, patch));
          openModal({
            title: 'أثر التعديل قبل الحفظ',
            body: `${previewHtml(preview)}
              <form data-form="ch-save-confirm" data-level="${esc(lvId)}" data-id="${esc(chId)}" data-patch="${esc(JSON.stringify(patch))}">
                <div class="actions-end"><button class="primary" type="submit">احفظ التعديل</button></div></form>`,
          });
        } catch (e) {
          showError(e);
        }
        return;
      }
      runForm(form, () => ctx.store.update((s) => updateChallengeDef(s, lvId, chId, patch)), { successMessage: 'تم حفظ التحدي' });
    },
    'ch-save-confirm'(form) {
      const patch = JSON.parse(form.dataset.patch || '{}');
      runForm(form, () => ctx.store.update((s) => updateChallengeDef(s, form.dataset.level, form.dataset.id, patch)), { successMessage: 'تم حفظ التحدي' });
    },
    'sub-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => addSubtask(s, form.dataset.level, form.dataset.id, { title: d.title, type: d.type, target: d.target, weight: d.weight }, newId)),
      );
    },
    'ch-stop'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => stopChallenge(s, form.dataset.level, form.dataset.id, d.reason)), { successMessage: 'أُوقف التحدي' });
    },
    'ch-replace'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          replaceChallenge(
            s,
            form.dataset.level,
            form.dataset.id,
            { title: d.title, type: d.type, target: d.target, weight: d.weight, domainId: d.domainId || null },
            d.reason,
            newId,
          ),
        ),
        { successMessage: 'تم الاستبدال' },
      );
    },
  },
  changes: {},
};

function parseLinksLines(text) {
  return parseLines(text).map((line) => {
    const [a, b] = line.split('|').map((x) => x.trim());
    return b !== undefined ? { label: a, url: b } : { label: '', url: a };
  });
}

function showError(e) {
  toast(errMsg(e), 'error');
  closeModal();
  if (!(e instanceof ValidationError)) console.error(e);
}
