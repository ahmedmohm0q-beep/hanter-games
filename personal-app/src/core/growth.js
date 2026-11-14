// المجالات ونقاط التطوير والتقييمات والتحليلات.
// قاعدة الاتجاه: الدرجة الأعلى = وضع أفضل، سواء كانت النقطة قوة أو ضعفًا.
// إكمال التحديات لا يثبت تحسن السمة؛ التقييم الذاتي يُعرض منفصلًا.

import { ValidationError } from './money.js';
import { requireText, optionalText } from './text.js';
import { isISODate } from './dates.js';
import { challengeComplete, challengeProgress, levelProgress } from './levels.js';
import { completedLevels, currentLevel, sortedLevels } from './plan.js';

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

export function addDomain(state, name, idFactory) {
  const clean = requireText(name, 'اسم المجال', 60);
  if (state.growth.domains.some((d) => d.name.toLowerCase() === clean.toLowerCase())) {
    throw new ValidationError('يوجد مجال بهذا الاسم');
  }
  const domain = { id: idFactory(), name: clean };
  state.growth.domains.push(domain);
  return domain;
}

export function renameDomain(state, id, name) {
  const domain = state.growth.domains.find((d) => d.id === id);
  if (!domain) throw new ValidationError('المجال غير موجود');
  domain.name = requireText(name, 'اسم المجال', 60);
}

// لا يُحذف مجال مستخدم، لأن التحديات والنقاط تشير إليه.
export function deleteDomain(state, id) {
  const used =
    state.growth.points.some((p) => p.domainId === id) ||
    state.bank.some((b) => b.domainId === id) ||
    state.plan.levels.some((l) => (l.challenges || []).some((c) => c.domainId === id));
  if (used) throw new ValidationError('المجال مستخدم في نقاط أو تحديات؛ أعد ربطها أولًا');
  state.growth.domains = state.growth.domains.filter((d) => d.id !== id);
}

function checkScore(score) {
  const n = Number(score);
  if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
    throw new ValidationError(`الدرجة يجب أن تكون عددًا صحيحًا بين ${SCORE_MIN} و${SCORE_MAX}`);
  }
  return n;
}

export function addPoint(state, input, idFactory, now = new Date().toISOString()) {
  if (input.kind !== 'strength' && input.kind !== 'weakness') {
    throw new ValidationError('النوع يجب أن يكون نقطة قوة أو نقطة ضعف');
  }
  const date = input.date || now.slice(0, 10);
  if (!isISODate(date)) throw new ValidationError('تاريخ التقييم الأولي غير صحيح');
  const point = {
    id: idFactory(),
    kind: input.kind,
    name: requireText(input.name, 'اسم النقطة', 120),
    description: optionalText(input.description, 1000),
    domainId: input.domainId || null,
    archived: false,
    createdAt: now,
    // أول تقييم هو التقييم الأولي ولا يُحذف.
    evaluations: [{ id: idFactory(), date, score: checkScore(input.initialScore), note: optionalText(input.note, 500), initial: true }],
  };
  state.growth.points.push(point);
  return point;
}

export function updatePoint(state, id, patch) {
  const point = state.growth.points.find((p) => p.id === id);
  if (!point) throw new ValidationError('النقطة غير موجودة');
  if (patch.name !== undefined) point.name = requireText(patch.name, 'اسم النقطة', 120);
  if (patch.description !== undefined) point.description = optionalText(patch.description, 1000);
  if (patch.domainId !== undefined) point.domainId = patch.domainId || null;
  if (patch.archived !== undefined) point.archived = Boolean(patch.archived);
  return point;
}

export function addEvaluation(state, pointId, { date, score, note }, idFactory) {
  const point = state.growth.points.find((p) => p.id === pointId);
  if (!point) throw new ValidationError('النقطة غير موجودة');
  if (!isISODate(date)) throw new ValidationError('تاريخ التقييم غير صحيح');
  const last = point.evaluations[point.evaluations.length - 1];
  if (date < last.date) throw new ValidationError('تاريخ التقييم الجديد لا يسبق آخر تقييم');
  const ev = { id: idFactory(), date, score: checkScore(score), note: optionalText(note, 500), initial: false };
  point.evaluations.push(ev);
  return ev;
}

// مقارنة التقييم الأولي بآخر تقييم. موجب = تحسن، سالب = تراجع.
export function pointTrend(point) {
  const first = point.evaluations[0];
  const last = point.evaluations[point.evaluations.length - 1];
  if (point.evaluations.length < 2) {
    return { initial: first.score, latest: last.score, change: null, hasLaterEvaluation: false };
  }
  return { initial: first.score, latest: last.score, change: last.score - first.score, hasLaterEvaluation: true };
}

function domainName(state, id) {
  if (!id) return 'بدون مجال';
  return state.growth.domains.find((d) => d.id === id)?.name || 'مجال محذوف';
}

// التحليلات تُحسب من البيانات فقط ولا تختلق نتائج. أي قسم بلا بيانات يُرجع قائمة فارغة.
export function buildAnalytics(state) {
  const target = state.plan.targetLevels;
  const done = completedLevels(state);
  const cur = currentLevel(state);
  const levels = sortedLevels(state);

  // إنجازات مكتملة موثّقة من المستويات المكتملة فقط (snapshot).
  const completedChallenges = [];
  for (const lvl of done) {
    for (const ch of lvl.snapshot?.challenges || []) {
      if (ch.status === 'replaced') continue;
      completedChallenges.push({ ...ch, levelName: lvl.snapshot.name, levelOrder: lvl.snapshot.order });
    }
  }

  const byDomain = new Map();
  const byPoint = new Map();
  for (const ch of completedChallenges) {
    const dKey = ch.domainId || '';
    byDomain.set(dKey, (byDomain.get(dKey) || 0) + 1);
    if (ch.pointId) byPoint.set(ch.pointId, (byPoint.get(ch.pointId) || 0) + 1);
  }

  const stopped = [];
  const replaced = [];
  for (const lvl of levels) {
    for (const ch of lvl.challenges || []) {
      if (ch.status === 'stopped') {
        stopped.push({ title: ch.title, levelName: lvl.name, reason: ch.stopReason || '', at: ch.stoppedAt });
      }
      if (ch.status === 'replaced') {
        replaced.push({
          title: ch.title,
          levelName: lvl.name,
          reason: ch.replaceReason || '',
          at: ch.replacedAt,
          progress: challengeProgress(ch),
        });
      }
    }
  }

  return {
    levels: {
      target,
      prepared: levels.length,
      preparedWithChallenges: levels.filter((l) => (l.challenges || []).some((c) => c.status !== 'replaced')).length,
      completed: done.length,
      remainingToTarget: Math.max(0, target - done.length),
      journeyPercent: target > 0 ? (done.length / target) * 100 : 0,
      current: cur
        ? {
            name: cur.name,
            order: cur.order,
            progress: levelProgress(cur),
            complete: (cur.challenges || []).filter((c) => c.status !== 'replaced').every(challengeComplete) &&
              (cur.challenges || []).some((c) => c.status !== 'replaced'),
          }
        : null,
    },
    completedChallengeCount: completedChallenges.length,
    byDomain: [...byDomain.entries()].map(([id, count]) => ({ name: domainName(state, id || null), count })),
    byPoint: state.growth.points
      .filter((p) => byPoint.has(p.id))
      .map((p) => ({ name: p.name, count: byPoint.get(p.id), kind: p.kind })),
    points: state.growth.points.map((p) => ({ id: p.id, name: p.name, kind: p.kind, archived: p.archived, domain: domainName(state, p.domainId), ...pointTrend(p) })),
    stopped,
    replaced,
    awards: [...state.awards].sort((a, b) => (a.awardedAt < b.awardedAt ? 1 : -1)),
    completedLevels: done.map((l) => ({ name: l.name, order: l.order, completedAt: l.completedAt })),
    log: [...state.log].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200),
  };
}
