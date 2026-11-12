import { ctx } from '../ctx.js';
import { esc, pct, bar, badge, emptyState, formData, compressImage } from '../util.js';
import { openModal, toast } from '../modal.js';
import { runForm, runAction } from '../run.js';
import { newId } from '../../core/state.js';
import { normalizeDigits } from '../../core/money.js';
import {
  currentLevel,
  completedLevels,
  setChallengeDone,
  setSubtaskDone,
  addEvidence,
  sortedLevels,
} from '../../core/plan.js';
import { challengeProgress, levelProgress, activeChallenges, isLevelPrepared } from '../../core/levels.js';

const TYPE_LABEL = { binary: 'ثنائي', numeric: 'رقمي', composite: 'مركّب' };

function evidenceList(ch) {
  const items = ch.evidence || [];
  if (!items.length) return '<p class="hint small">لا توجد أدلة مرفقة بعد.</p>';
  return `<ul class="evidence">${items
    .map((e) => {
      if (e.kind === 'link') return `<li>🔗 <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.label || e.url)}</a></li>`;
      if (e.kind === 'image') return `<li><img class="thumb" src="${esc(e.dataUrl)}" alt="${esc(e.label || 'دليل مرفق')}" /> ${esc(e.label || '')}</li>`;
      return `<li>📝 ${esc(e.text)}</li>`;
    })
    .join('')}</ul>`;
}

function subtaskRow(level, ch, sub, locked) {
  const disabled = locked || ch.status === 'stopped' ? 'disabled' : '';
  if (sub.type === 'binary') {
    return `<li class="sub-row">
      <label class="check"><input type="checkbox" data-change="sub-bool" data-level="${esc(level.id)}" data-ch="${esc(ch.id)}" data-id="${esc(sub.id)}" ${sub.done === true ? 'checked' : ''} ${disabled} /> ${esc(sub.title)}</label>
      <span class="hint small">وزن ${sub.weight}</span></li>`;
  }
  return `<li class="sub-row">
    <span>${esc(sub.title)} <span class="hint small">من ${sub.target}</span></span>
    <input class="num" inputmode="decimal" value="${esc(sub.done ?? 0)}" data-change="sub-num" data-level="${esc(level.id)}" data-ch="${esc(ch.id)}" data-id="${esc(sub.id)}" aria-label="تقدم ${esc(sub.title)}" ${disabled} />
    <span class="hint small">وزن ${sub.weight}</span></li>`;
}

function challengeCard(state, level, ch) {
  const prog = challengeProgress(ch);
  const stopped = ch.status === 'stopped';
  const dom = state.growth.domains.find((d) => d.id === ch.domainId);
  let control = '';
  if (ch.type === 'binary') {
    control = `<button type="button" class="${ch.done ? 'primary' : 'ghost'} done-btn" data-act="ch-toggle" data-level="${esc(level.id)}" data-id="${esc(ch.id)}" data-value="${ch.done ? '0' : '1'}" ${stopped ? 'disabled' : ''} aria-pressed="${ch.done === true}">${ch.done ? '✓ تم' : 'لم يتم بعد'}</button>`;
  } else if (ch.type === 'numeric') {
    control = `<label class="num-row">التقدم ${ch.unit ? `(${esc(ch.unit)})` : ''}
      <input class="num" inputmode="decimal" value="${esc(ch.done ?? 0)}" data-change="ch-num" data-level="${esc(level.id)}" data-id="${esc(ch.id)}" ${stopped ? 'disabled' : ''} />
      <span class="hint">من ${ch.target}</span></label>`;
  } else {
    control = `<ul class="plain subs">${(ch.subtasks || []).map((s) => subtaskRow(level, ch, s, false)).join('') || '<li class="hint">لا توجد مهام بعد. أضفها من صفحة الرحلة.</li>'}</ul>`;
  }
  return `
    <li class="current-ch ${stopped ? 'stopped' : ''}">
      <div class="ch-head">
        <strong>${esc(ch.title)}</strong>
        <div class="tags">${badge(TYPE_LABEL[ch.type])} ${badge(`وزن ${ch.weight}`)} ${dom ? badge(dom.name) : ''} ${stopped ? badge('متوقف: لا يكتمل حتى تستأنفه', 'warn') : ''}</div>
      </div>
      ${ch.description ? `<p class="hint small">${esc(ch.description)}</p>` : ''}
      ${ch.successCriteria?.length ? `<ul class="plain small criteria">${ch.successCriteria.map((c) => `<li>✔ ${esc(c)}</li>`).join('')}</ul>` : ''}
      <div class="progress-row">${bar(prog, ch.title)}<b>${pct(prog)}</b></div>
      ${control}
      <details class="evidence-box"><summary>الأدلة والملاحظات (${(ch.evidence || []).length})</summary>
        ${evidenceList(ch)}
        <button type="button" class="ghost" data-act="ev-open" data-level="${esc(level.id)}" data-id="${esc(ch.id)}">+ دليل أو ملاحظة</button>
      </details>
      ${stopped && ch.stopReason ? `<p class="hint small">سبب الإيقاف: ${esc(ch.stopReason)}</p>` : ''}
    </li>`;
}

function noCurrent(state) {
  const levels = sortedLevels(state);
  const done = completedLevels(state).length;
  // المجهز القادم فقط: المكتمل لا يُعاد عرضه كمستوى جاهز للبدء.
  const prepared = levels.filter((l) => l.status === 'upcoming' && isLevelPrepared(l));
  if (levels.length === 0) {
    return emptyState('لا يوجد مستوى بعد', 'ابدأ من صفحة الرحلة بإنشاء أول مستوى وإضافة تحدٍّ إليه.', '<a class="btn primary" href="#/journey">إعداد الرحلة</a>');
  }
  if (done > 0 && prepared.length === 0) {
    return emptyState(
      'أكملت المستويات المجهزة',
      `أكملت ${done} مستوى. جهّز المستوى التالي بتحدٍّ واحد على الأقل لتبدأ.`,
      '<a class="btn primary" href="#/journey">تجهيز المستوى التالي</a>',
    );
  }
  return emptyState('لا يوجد مستوى حالي', 'أضف تحدّيًا إلى مستوى قادم ليصبح المستوى الحالي تلقائيًا.', '<a class="btn primary" href="#/journey">إعداد الرحلة</a>');
}

export function renderCurrent(state) {
  const level = currentLevel(state);
  if (!level) return noCurrent(state);
  const target = state.plan.targetLevels;
  const done = completedLevels(state).length;
  const remaining = Math.max(0, target - done);
  const active = activeChallenges(level);
  const overall = levelProgress(level);
  return `
    <article class="card level-hero">
      <span class="chip-status current">المستوى الحالي</span>
      <h2>${level.order}. ${esc(level.name)}</h2>
      ${level.description ? `<p>${esc(level.description)}</p>` : ''}
      <div class="progress-row big">${bar(overall, 'نسبة إنجاز المستوى')}<b>${pct(overall)}</b></div>
      <p class="hint small">نسبة الإنجاز الإجمالية للعرض فقط. الترقية تحدث عندما تكتمل كل التحديات النشطة بشرطها الفعلي، لا عند تقريب النسبة.</p>
      <div class="kpis">
        <div class="kpi"><span>تحديات نشطة</span><b>${active.length}</b></div>
        <div class="kpi"><span>المكتملة / المستهدف</span><b>${done} / ${target}</b><small>المتبقي: ${remaining}</small></div>
      </div>
      <div class="reward-line">
        ${level.reward ? `🎁 المكافأة المنتظرة: <strong>${esc(level.reward.title)}</strong>${level.reward.note ? ` — ${esc(level.reward.note)}` : ''}` : 'لا توجد مكافأة لهذا المستوى.'}
        ${level.badge ? `<br>${esc(level.badge.icon || '🏅')} الشارة المنتظرة: <strong>${esc(level.badge.name)}</strong>` : ''}
      </div>
    </article>
    ${active.length === 0
      ? emptyState('لا توجد تحديات نشطة', 'المستوى الفارغ لا يُعتبر مكتملًا. أضف تحديًا من صفحة الرحلة.', '<a class="btn ghost" href="#/journey">إضافة تحدٍّ</a>')
      : `<ul class="current-list">${active.map((c) => challengeCard(state, level, c)).join('')}</ul>`}`;
}

// تسجيل تقدم مع تهنئة عند اكتمال مستوى فعلًا.
function recordProgress(mutator) {
  const before = completedLevels(ctx.store.state).length;
  const ok = runAction(() => ctx.store.update(mutator));
  const after = completedLevels(ctx.store.state).length;
  if (after > before) {
    toast('🎉 أكملت المستوى! المكافأة والشارة سُجّلتا في إنجازاتك.', 'ok');
  }
  return ok;
}

export const handlers = {
  acts: {
    'ch-toggle'(el) {
      const value = el.dataset.value === '1';
      recordProgress((s) => setChallengeDone(s, el.dataset.level, el.dataset.id, value));
    },
    'ev-open'(el) {
      openModal({
        title: 'إضافة دليل أو ملاحظة',
        body: `<form data-form="ev-add" data-level="${esc(el.dataset.level)}" data-id="${esc(el.dataset.id)}" class="form-grid">
          <label>النوع<select name="kind"><option value="note">ملاحظة</option><option value="link">رابط</option><option value="image">صورة</option></select></label>
          <label>عنوان مختصر (اختياري)<input name="label" maxlength="200" /></label>
          <label class="wide">النص أو الملاحظة<textarea name="text" rows="2" maxlength="2000"></textarea></label>
          <label class="wide">الرابط (للروابط فقط)<input name="url" inputmode="url" placeholder="https://" /></label>
          <label class="wide">الصورة (للصور فقط، تُضغط تلقائيًا)<input name="file" type="file" accept="image/*" /></label>
          <div class="wide actions-end"><button class="primary" type="submit">إضافة</button></div></form>`,
      });
    },
  },
  forms: {
    async 'ev-add'(form) {
      const d = formData(form);
      try {
        const payload = { kind: d.kind, label: d.label, text: d.text, url: d.url };
        if (d.kind === 'image') {
          const file = d.file;
          if (!file || !file.size) throw new Error('اختر صورة أولًا');
          payload.dataUrl = await compressImage(file, 1000, 0.8);
        }
        runForm(form, () => ctx.store.update((s) => addEvidence(s, form.dataset.level, form.dataset.id, payload, newId)), {
          successMessage: 'أُضيف الدليل',
        });
      } catch (e) {
        runForm(form, () => {
          throw e;
        });
      }
    },
  },
  changes: {
    'ch-num'(el) {
      const raw = normalizeDigits(el.value).trim();
      const n = Number(raw === '' ? 0 : raw);
      if (!Number.isFinite(n) || n < 0) {
        toast('أدخل رقمًا صفرًا أو أكبر', 'error');
        return;
      }
      recordProgress((s) => setChallengeDone(s, el.dataset.level, el.dataset.id, n));
    },
    'sub-bool'(el) {
      recordProgress((s) => setSubtaskDone(s, el.dataset.level, el.dataset.ch, el.dataset.id, el.checked));
    },
    'sub-num'(el) {
      const raw = normalizeDigits(el.value).trim();
      const n = Number(raw === '' ? 0 : raw);
      if (!Number.isFinite(n) || n < 0) {
        toast('أدخل رقمًا صفرًا أو أكبر', 'error');
        return;
      }
      recordProgress((s) => setSubtaskDone(s, el.dataset.level, el.dataset.ch, el.dataset.id, n));
    },
  },
};
