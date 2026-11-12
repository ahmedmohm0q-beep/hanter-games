// حساب التقدم والإكمال للتحديات والمستويات.
// قاعدة الترقية: المستوى مكتمل فقط عند اكتمال كل تحدٍّ نشط بشرطه الفعلي (boolean)،
// وليس عند تقريب النسبة المعروضة. النسبة الموزونة للعرض فقط.

import { ValidationError } from './money.js';

export const CHALLENGE_TYPES = ['binary', 'numeric', 'composite'];
export const CHALLENGE_STATUSES = ['active', 'stopped', 'replaced'];

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function clamp01(v) {
  return Math.min(Math.max(v, 0), 1);
}

// --- المهام الصغيرة ---
export function subtaskProgress(sub) {
  if (sub.type === 'binary') return sub.done === true ? 1 : 0;
  if (!isPositiveNumber(sub.target)) return 0;
  return clamp01((Number(sub.done) || 0) / sub.target);
}

export function subtaskComplete(sub) {
  if (sub.type === 'binary') return sub.done === true;
  return isPositiveNumber(sub.target) && (Number(sub.done) || 0) >= sub.target;
}

// --- التحديات ---
export function challengeProgress(ch) {
  if (ch.type === 'binary') return ch.done === true ? 1 : 0;
  if (ch.type === 'numeric') {
    if (!isPositiveNumber(ch.target)) return 0;
    return clamp01((Number(ch.done) || 0) / ch.target);
  }
  // مركّب: متوسط موزون لمهامه. لا توجد نسبة يدوية مستقلة.
  const subs = ch.subtasks || [];
  const totalWeight = subs.reduce((sum, s) => sum + s.weight, 0);
  if (subs.length === 0 || totalWeight <= 0) return 0;
  return subs.reduce((sum, s) => sum + subtaskProgress(s) * s.weight, 0) / totalWeight;
}

// هل استوفى التحدي شرطه الفعلي؟ (بدون النظر إلى حالة الإيقاف)
export function challengeCriteriaMet(ch) {
  if (ch.type === 'binary') return ch.done === true;
  if (ch.type === 'numeric') return isPositiveNumber(ch.target) && (Number(ch.done) || 0) >= ch.target;
  const subs = ch.subtasks || [];
  return subs.length > 0 && subs.every(subtaskComplete);
}

// التحدي المتوقف لا يكتمل حتى يُستأنف أو تُعدَّل الخطة صراحةً.
export function challengeComplete(ch) {
  if (ch.status === 'replaced' || ch.status === 'stopped') return false;
  return challengeCriteriaMet(ch);
}

export function activeChallenges(level) {
  return (level.challenges || []).filter((c) => c.status !== 'replaced');
}

// --- المستوى ---
export function levelProgress(level) {
  const active = activeChallenges(level);
  const totalWeight = active.reduce((sum, c) => sum + c.weight, 0);
  if (active.length === 0 || totalWeight <= 0) return 0;
  return active.reduce((sum, c) => sum + challengeProgress(c) * c.weight, 0) / totalWeight;
}

export function levelComplete(level) {
  const active = activeChallenges(level);
  return active.length > 0 && active.every(challengeComplete);
}

// "مجهز" = له اسم وفيه تحدٍّ نشط واحد على الأقل.
export function isLevelPrepared(level) {
  return Boolean(level.name && level.name.trim()) && activeChallenges(level).length > 0;
}

// --- التحقق من صحة البيانات قبل الحفظ ---
export function validateSubtask(sub) {
  if (!sub.title || !sub.title.trim()) throw new ValidationError('عنوان المهمة الصغيرة مطلوب');
  if (!['binary', 'numeric'].includes(sub.type)) throw new ValidationError('نوع المهمة غير معروف');
  if (sub.type === 'numeric' && !isPositiveNumber(sub.target)) {
    throw new ValidationError('الهدف الرقمي للمهمة يجب أن يكون أكبر من صفر');
  }
  if (!isPositiveNumber(sub.weight)) throw new ValidationError('وزن المهمة يجب أن يكون أكبر من صفر');
}

export function validateChallenge(ch) {
  if (!ch.title || !ch.title.trim()) throw new ValidationError('عنوان التحدي مطلوب');
  if (!CHALLENGE_TYPES.includes(ch.type)) throw new ValidationError('نوع التحدي غير معروف');
  if (!CHALLENGE_STATUSES.includes(ch.status)) throw new ValidationError('حالة التحدي غير معروفة');
  if (!isPositiveNumber(ch.weight)) throw new ValidationError('وزن التحدي يجب أن يكون أكبر من صفر');
  if (ch.type === 'numeric' && !isPositiveNumber(ch.target)) {
    throw new ValidationError('الهدف الرقمي يجب أن يكون أكبر من صفر');
  }
  if (ch.type === 'composite') {
    (ch.subtasks || []).forEach(validateSubtask);
  }
}

// يُنشئ تحدٍّ جديدًا بقيم افتراضية آمنة. التقدم يبدأ من الصفر دائمًا.
export function newChallenge(input, idFactory) {
  const ch = {
    id: idFactory(),
    title: String(input.title ?? '').trim(),
    description: String(input.description ?? ''),
    type: input.type ?? 'binary',
    target: input.type === 'numeric' ? Number(input.target) : null,
    unit: String(input.unit ?? ''),
    done: input.type === 'binary' ? false : 0,
    weight: input.weight === undefined ? 1 : Number(input.weight),
    status: 'active',
    domainId: input.domainId ?? null,
    pointId: input.pointId ?? null,
    subtasks: (input.subtasks || []).map((s) => ({
      id: idFactory(),
      title: String(s.title ?? '').trim(),
      type: s.type ?? 'binary',
      target: s.type === 'numeric' ? Number(s.target) : null,
      done: s.type === 'numeric' ? 0 : false,
      weight: s.weight === undefined ? 1 : Number(s.weight),
    })),
    successCriteria: (input.successCriteria || []).map((t) => String(t).trim()).filter(Boolean),
    evidence: [],
    sourceBankId: input.sourceBankId ?? null,
    partOfGoalId: input.partOfGoalId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  validateChallenge(ch);
  return ch;
}
