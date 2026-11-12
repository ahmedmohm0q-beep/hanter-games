// عمليات الخطة على مسودة الحالة (draft). كل دالة ترمي ValidationError عند خطأ،
// فيُلغى الحفظ كله (انظر store.update). الترقية تُفحص بعد انتهاء الدفعة كلها.

import { ValidationError } from './money.js';
import {
  newChallenge,
  validateSubtask,
  validateChallenge,
  levelComplete,
  levelProgress,
  isLevelPrepared,
  challengeProgress,
} from './levels.js';
import { requireText, optionalText, isSafeHttpUrl } from './text.js';
import { newId } from './state.js';

// --- بحث وأدوات مساعدة ---
export function sortedLevels(state) {
  return [...state.plan.levels].sort((a, b) => a.order - b.order);
}

export function findLevel(state, id) {
  const level = state.plan.levels.find((l) => l.id === id);
  if (!level) throw new ValidationError('المستوى غير موجود');
  return level;
}

export function findChallenge(level, id) {
  const ch = (level.challenges || []).find((c) => c.id === id);
  if (!ch) throw new ValidationError('التحدي غير موجود');
  return ch;
}

export function currentLevel(state) {
  return state.plan.levels.find((l) => l.status === 'current') || null;
}

export function completedLevels(state) {
  return state.plan.levels.filter((l) => l.status === 'completed');
}

function assertEditable(level) {
  if (level.status === 'completed') {
    throw new ValidationError('المستوى المكتمل محفوظ بنسخته الأصلية ولا يُعدَّل');
  }
}

function logEntry(state, kind, text, now) {
  state.log.push({ id: newId(), at: now, kind, text });
}

function validateLinks(links = []) {
  return links.map((l) => {
    if (!isSafeHttpUrl(l.url)) throw new ValidationError('الرابط يجب أن يبدأ بـ http أو https');
    return { label: optionalText(l.label, 120), url: l.url.trim() };
  });
}

// --- المستويات ---
export function addLevel(state, input, idFactory, now = new Date().toISOString()) {
  const order = state.plan.levels.reduce((max, l) => Math.max(max, l.order), 0) + 1;
  const reward = input.reward && (input.reward.title || '').trim()
    ? { title: requireText(input.reward.title, 'عنوان المكافأة', 200), note: optionalText(input.reward.note, 500) }
    : null;
  const badge = input.badge && (input.badge.name || '').trim()
    ? { name: requireText(input.badge.name, 'اسم الشارة', 100), icon: String(input.badge.icon ?? '').slice(0, 8) }
    : null;
  const level = {
    id: idFactory(),
    order,
    name: requireText(input.name, 'اسم المستوى', 120),
    description: optionalText(input.description, 1000),
    reward,
    badge,
    status: 'upcoming',
    challenges: [],
    links: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    snapshot: null,
  };
  state.plan.levels.push(level);
  return level;
}

export function updateLevelMeta(state, levelId, patch, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  if (patch.name !== undefined) level.name = requireText(patch.name, 'اسم المستوى', 120);
  if (patch.description !== undefined) level.description = optionalText(patch.description, 1000);
  if (patch.reward !== undefined) {
    level.reward = patch.reward && (patch.reward.title || '').trim()
      ? { title: requireText(patch.reward.title, 'عنوان المكافأة', 200), note: optionalText(patch.reward.note, 500) }
      : null;
  }
  if (patch.badge !== undefined) {
    level.badge = patch.badge && (patch.badge.name || '').trim()
      ? { name: requireText(patch.badge.name, 'اسم الشارة', 100), icon: String(patch.badge.icon ?? '').slice(0, 8) }
      : null;
  }
  if (patch.links !== undefined) level.links = validateLinks(patch.links);
  level.updatedAt = now;
  return level;
}

export function deleteUpcomingLevel(state, levelId) {
  const level = findLevel(state, levelId);
  if (level.status !== 'upcoming') throw new ValidationError('لا يُحذف إلا مستوى قادم');
  if ((level.challenges || []).length > 0) {
    throw new ValidationError('المستوى فيه تحديات؛ أفرغه أولًا أو احذفه من التحديات');
  }
  state.plan.levels = state.plan.levels.filter((l) => l.id !== levelId);
}

// تبديل ترتيب مستوى قادم مع جاره القادم فقط.
export function moveUpcomingLevel(state, levelId, direction) {
  const list = sortedLevels(state);
  const idx = list.findIndex((l) => l.id === levelId);
  if (idx === -1) throw new ValidationError('المستوى غير موجود');
  const level = list[idx];
  if (level.status !== 'upcoming') throw new ValidationError('يمكن ترتيب المستويات القادمة فقط');
  const neighbor = list[idx + direction];
  if (!neighbor || neighbor.status !== 'upcoming') return;
  const tmp = level.order;
  level.order = neighbor.order;
  neighbor.order = tmp;
}

// عدد المستويات المستهدف مستقل عن عدد المستويات المجهزة. لا يحذف أي مستوى.
export function setTargetLevels(state, target) {
  const n = Number(target);
  if (!Number.isSafeInteger(n) || n < 1) throw new ValidationError('عدد المستويات يجب أن يكون عددًا صحيحًا موجبًا');
  const done = completedLevels(state).length;
  if (n < done) {
    throw new ValidationError(`لا يمكن أن يكون الهدف أقل من المستويات المكتملة (${done})، لأنها محفوظة`);
  }
  state.plan.targetLevels = n;
  return { exceedsPrepared: state.plan.levels.length > n, count: state.plan.levels.length };
}

// --- التحديات ---
export function addChallenge(state, levelId, input, idFactory, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = newChallenge(input, idFactory);
  ch.createdAt = now;
  level.challenges.push(ch);
  level.updatedAt = now;
  return ch;
}

const DEF_FIELDS = ['title', 'description', 'weight', 'target', 'unit', 'domainId', 'pointId', 'successCriteria'];

export function updateChallengeDef(state, levelId, chId, patch, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  if (ch.status === 'replaced') throw new ValidationError('التحدي المستبدل للقراءة فقط');
  for (const key of Object.keys(patch)) {
    if (!DEF_FIELDS.includes(key)) throw new ValidationError(`الحقل ${key} لا يُعدَّل هنا`);
  }
  if (patch.title !== undefined) ch.title = requireText(patch.title, 'عنوان التحدي', 200);
  if (patch.description !== undefined) ch.description = optionalText(patch.description);
  if (patch.weight !== undefined) ch.weight = Number(patch.weight);
  if (patch.target !== undefined && ch.type === 'numeric') ch.target = Number(patch.target);
  if (patch.unit !== undefined) ch.unit = optionalText(patch.unit, 40);
  if (patch.domainId !== undefined) ch.domainId = patch.domainId || null;
  if (patch.pointId !== undefined) ch.pointId = patch.pointId || null;
  if (patch.successCriteria !== undefined) {
    ch.successCriteria = patch.successCriteria.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  }
  validateChallenge(ch);
  ch.updatedAt = now;
  level.updatedAt = now;
  return ch;
}

export function addSubtask(state, levelId, chId, input, idFactory, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  if (ch.type !== 'composite') throw new ValidationError('المهام الصغيرة تُضاف للتحدي المركب فقط');
  const sub = {
    id: idFactory(),
    title: String(input.title ?? '').trim(),
    type: input.type === 'numeric' ? 'numeric' : 'binary',
    target: input.type === 'numeric' ? Number(input.target) : null,
    done: input.type === 'numeric' ? 0 : false,
    weight: input.weight === undefined || input.weight === '' ? 1 : Number(input.weight),
  };
  validateSubtask(sub);
  ch.subtasks.push(sub);
  ch.updatedAt = now;
  level.updatedAt = now;
  return sub;
}

function findSub(ch, subId) {
  const sub = (ch.subtasks || []).find((s) => s.id === subId);
  if (!sub) throw new ValidationError('المهمة الصغيرة غير موجودة');
  return sub;
}

export function updateSubtask(state, levelId, chId, subId, patch, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  const sub = findSub(ch, subId);
  if (patch.title !== undefined) sub.title = String(patch.title).trim();
  if (patch.weight !== undefined) sub.weight = Number(patch.weight);
  if (patch.target !== undefined && sub.type === 'numeric') sub.target = Number(patch.target);
  validateSubtask(sub);
  ch.updatedAt = now;
  return sub;
}

export function removeSubtask(state, levelId, chId, subId, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  const sub = findSub(ch, subId);
  const hasProgress = sub.type === 'binary' ? sub.done === true : Number(sub.done) > 0;
  if (hasProgress) throw new ValidationError('للمهمة تقدم مسجَّل؛ استبدل التحدي بدل حذف المهمة');
  ch.subtasks = ch.subtasks.filter((s) => s.id !== subId);
  ch.updatedAt = now;
}

export function removeChallenge(state, levelId, chId, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  if (challengeProgress(ch) > 0) {
    throw new ValidationError('للتحدي تقدم مسجَّل؛ أوقفه أو استبدله بسبب بدل الحذف');
  }
  level.challenges = level.challenges.filter((c) => c.id !== chId);
  level.updatedAt = now;
}

// --- تسجيل التقدم: المستوى الحالي فقط ---
function assertRecordable(level, ch) {
  if (level.status !== 'current') throw new ValidationError('تسجيل الإنجاز يكون في المستوى الحالي فقط');
  if (ch.status === 'replaced') throw new ValidationError('التحدي مستبدل ولا يُسجَّل عليه تقدم');
  if (ch.status === 'stopped') throw new ValidationError('التحدي متوقف؛ استأنفه أولًا لتسجيل التقدم');
}

export function setChallengeDone(state, levelId, chId, value, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  const ch = findChallenge(level, chId);
  assertRecordable(level, ch);
  if (ch.type === 'composite') throw new ValidationError('التحدي المركب يُحسب من مهامه، سجّل المهام نفسها');
  if (ch.type === 'binary') {
    if (typeof value !== 'boolean') throw new ValidationError('القيمة يجب أن تكون صح أو خطأ');
    ch.done = value;
  } else {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError('القيمة يجب أن تكون رقمًا صفرًا أو أكبر');
    ch.done = n;
  }
  ch.updatedAt = now;
  level.updatedAt = now;
}

export function setSubtaskDone(state, levelId, chId, subId, value, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  const ch = findChallenge(level, chId);
  assertRecordable(level, ch);
  if (ch.type !== 'composite') throw new ValidationError('المهام الصغيرة تخص التحدي المركب فقط');
  const sub = findSub(ch, subId);
  if (sub.type === 'binary') {
    if (typeof value !== 'boolean') throw new ValidationError('القيمة يجب أن تكون صح أو خطأ');
    sub.done = value;
  } else {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError('القيمة يجب أن تكون رقمًا صفرًا أو أكبر');
    sub.done = n;
  }
  ch.updatedAt = now;
  level.updatedAt = now;
}

// إضافة دليل (ملاحظة أو رابط أو صورة) للتحدي. الصورة تأتي كـ data URL مضغوط من الواجهة.
export function addEvidence(state, levelId, chId, evidence, idFactory, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  const ch = findChallenge(level, chId);
  const item = { id: idFactory(), at: now, kind: evidence.kind };
  if (evidence.kind === 'link') {
    if (!isSafeHttpUrl(evidence.url)) throw new ValidationError('الرابط غير صالح');
    item.url = evidence.url.trim();
    item.label = optionalText(evidence.label, 200);
  } else if (evidence.kind === 'image') {
    if (typeof evidence.dataUrl !== 'string' || !evidence.dataUrl.startsWith('data:image/')) {
      throw new ValidationError('ملف الصورة غير صالح');
    }
    item.dataUrl = evidence.dataUrl;
    item.label = optionalText(evidence.label, 200);
  } else {
    item.text = requireText(evidence.text, 'نص الملاحظة', 2000);
  }
  ch.evidence = [...(ch.evidence || []), item];
  ch.updatedAt = now;
  level.updatedAt = now;
  return item;
}

// --- الإيقاف والاستبدال ---
export function stopChallenge(state, levelId, chId, reason, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  if (ch.status !== 'active') throw new ValidationError('التحدي ليس نشطًا');
  ch.status = 'stopped';
  ch.stoppedAt = now;
  ch.stopReason = optionalText(reason, 500);
  ch.updatedAt = now;
  logEntry(state, 'challenge_stopped', `أُوقف التحدي: ${ch.title}`, now);
}

export function resumeChallenge(state, levelId, chId, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const ch = findChallenge(level, chId);
  if (ch.status !== 'stopped') throw new ValidationError('التحدي ليس متوقفًا');
  ch.status = 'active';
  ch.resumedAt = now;
  ch.updatedAt = now;
  logEntry(state, 'challenge_resumed', `استُؤنف التحدي: ${ch.title}`, now);
}

// الاستبدال يحفظ القديم كما هو مع تقدمه وسببه، والبديل يبدأ بتقدمه الخاص.
export function replaceChallenge(state, levelId, chId, input, reason, idFactory, now = new Date().toISOString()) {
  const level = findLevel(state, levelId);
  assertEditable(level);
  const old = findChallenge(level, chId);
  if (old.status === 'replaced') throw new ValidationError('التحدي مستبدل بالفعل');
  const why = requireText(reason, 'سبب الاستبدال', 500);
  const replacement = newChallenge(input, idFactory);
  replacement.createdAt = now;
  old.status = 'replaced';
  old.replacedAt = now;
  old.replaceReason = why;
  old.replacedById = replacement.id;
  old.updatedAt = now;
  level.challenges.push(replacement);
  level.updatedAt = now;
  logEntry(state, 'challenge_replaced', `استُبدل التحدي "${old.title}" بـ "${replacement.title}": ${why}`, now);
  return replacement;
}

// --- من البنك إلى المستوى ---
export function instantiateFromBank(state, bankId, levelId, idFactory, now = new Date().toISOString()) {
  const item = state.bank.find((b) => b.id === bankId);
  if (!item) throw new ValidationError('العنصر غير موجود في البنك');
  if (item.status === 'archived') throw new ValidationError('العنصر مؤرشف؛ أعد تفعيله أولًا');
  const level = findLevel(state, levelId);
  assertEditable(level);
  let created = null;

  if (item.type === 'big_goal') {
    throw new ValidationError('الهدف الكبير يُوزَّع على عدة مستويات من خيار "توزيع الهدف"');
  }
  if (item.type === 'reward') {
    if (level.reward) throw new ValidationError('للمستوى مكافأة بالفعل؛ عدّلها أولًا');
    level.reward = { title: item.title, note: item.description || '' };
  } else if (item.type === 'resource') {
    if (!item.links.length) throw new ValidationError('المصدر لا يحتوي رابطًا');
    level.links = [...level.links, ...item.links.map((l) => ({ label: l.label || item.title, url: l.url }))];
  } else {
    created = newChallenge(
      {
        title: item.title,
        description: item.description,
        type: item.measure,
        target: item.target,
        unit: item.unit,
        weight: item.weight,
        subtasks: item.subtasks,
        successCriteria: item.successCriteria,
        domainId: item.domainId,
        pointId: item.pointId,
        sourceBankId: item.id,
      },
      idFactory,
    );
    created.createdAt = now;
    level.challenges.push(created);
  }

  item.usedCount = (item.usedCount || 0) + 1;
  item.status = 'used';
  item.updatedAt = now;
  level.updatedAt = now;
  return created;
}

// توزيع هدف كبير على مستويات مختلفة: كل جزء تحدٍّ مستقل يحمل مرجع الهدف.
export function distributeGoal(state, goalId, parts, idFactory, now = new Date().toISOString()) {
  const goal = state.bank.find((b) => b.id === goalId);
  if (!goal || goal.type !== 'big_goal') throw new ValidationError('الهدف الكبير غير موجود');
  if (goal.status === 'archived') throw new ValidationError('الهدف مؤرشف');
  if (!parts || parts.length === 0) throw new ValidationError('أضف جزءًا واحدًا على الأقل');
  const created = parts.map((p) => {
    const level = findLevel(state, p.levelId);
    assertEditable(level);
    const ch = newChallenge(
      {
        title: p.title,
        description: p.description,
        type: p.measure,
        target: p.target,
        unit: p.unit,
        weight: p.weight,
        subtasks: p.subtasks,
        successCriteria: p.successCriteria,
        domainId: goal.domainId,
        pointId: goal.pointId,
        sourceBankId: goal.id,
        partOfGoalId: goal.id,
      },
      idFactory,
    );
    ch.createdAt = now;
    level.challenges.push(ch);
    level.updatedAt = now;
    return { levelId: level.id, challenge: ch };
  });
  goal.usedCount = (goal.usedCount || 0) + created.length;
  goal.status = 'used';
  goal.updatedAt = now;
  return created;
}

// --- الترقية ---
// المستوى الحالي = أول مستوى قادم مجهز إذا لم يكن هناك حالي.
export function ensureCurrentLevel(state) {
  if (currentLevel(state)) return null;
  const next = sortedLevels(state).find((l) => l.status === 'upcoming' && isLevelPrepared(l));
  if (!next) return null;
  next.status = 'current';
  return next;
}

// إكمال المستوى الحالي عند اكتمال كل تحدٍّ نشط. المكافأة والشارة تُمنحان مرة واحدة فقط.
export function completeIfReady(state, now = new Date().toISOString()) {
  const cur = currentLevel(state);
  if (!cur || !levelComplete(cur)) return null;
  cur.status = 'completed';
  cur.completedAt = now;
  cur.updatedAt = now;
  cur.snapshot = JSON.parse(
    JSON.stringify({
      order: cur.order,
      name: cur.name,
      description: cur.description,
      reward: cur.reward,
      badge: cur.badge,
      challenges: cur.challenges,
      links: cur.links,
    }),
  );
  for (const kind of ['reward', 'badge']) {
    const payload = cur[kind];
    if (!payload) continue;
    const key = `level:${cur.id}:${kind}`;
    if (state.awards.some((a) => a.key === key)) continue;
    state.awards.push({
      id: newId(),
      key,
      levelId: cur.id,
      kind,
      title: kind === 'reward' ? payload.title : payload.name,
      icon: kind === 'badge' ? payload.icon || '' : '',
      awardedAt: now,
    });
  }
  logEntry(state, 'level_completed', `أُكمل المستوى ${cur.order}: ${cur.name}`, now);
  return cur;
}

// تشغيل الترقية حتى تستقر الحالة. لا تُكمل مستويات فارغة أو غير مكتملة.
export function settlePlan(state, now = new Date().toISOString()) {
  for (let i = 0; i < 1000; i++) {
    ensureCurrentLevel(state);
    if (!completeIfReady(state, now)) break;
  }
  ensureCurrentLevel(state);
  return state;
}

// معاينة أثر تعديل قبل الحفظ: تُطبَّق الدالة على نسخة ولا تُحفظ.
export function previewPlanChange(state, mutate, now = new Date().toISOString()) {
  const summary = (s) => {
    const cur = currentLevel(s);
    return {
      currentName: cur ? cur.name : null,
      progress: cur ? levelProgress(cur) : null,
      complete: cur ? levelComplete(cur) : false,
      completedCount: completedLevels(s).length,
    };
  };
  const before = summary(state);
  const draft = structuredClone(state);
  mutate(draft);
  settlePlan(draft, now);
  return { before, after: summary(draft) };
}
