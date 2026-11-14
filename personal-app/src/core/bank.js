// بنك الأفكار والتحديات: قوالب مستقلة عن المستويات. عنصر البنك لا يدخل في أي حساب تقدّم.
// الإضافة إلى مستوى تنشئ نسخة تنفيذية مستقلة (انظر plan.js).

import { ValidationError } from './money.js';
import { isSafeHttpUrl, requireText, optionalText } from './text.js';

export const BANK_TYPES = {
  idea: 'فكرة',
  challenge: 'تحدٍّ',
  big_goal: 'هدف كبير',
  task: 'مهمة',
  reward: 'مكافأة',
  resource: 'مصدر أو رابط',
};

export const BANK_STATUSES = {
  draft: 'فكرة أولية',
  ready: 'جاهزة',
  used: 'مستخدمة',
  archived: 'مؤرشفة',
};

export const MEASURES = ['binary', 'numeric', 'composite'];

function findBank(state, id) {
  const item = state.bank.find((b) => b.id === id);
  if (!item) throw new ValidationError('العنصر غير موجود في البنك');
  return item;
}

function sanitizeLinks(links = []) {
  return links.map((l) => {
    if (!isSafeHttpUrl(l.url)) throw new ValidationError('الرابط يجب أن يبدأ بـ http أو https');
    return { label: optionalText(l.label, 120), url: l.url.trim() };
  });
}

function sanitizeSubtasks(list = []) {
  return list.map((s) => {
    const weight = s.weight === undefined || s.weight === '' ? 1 : Number(s.weight);
    if (!(weight > 0)) throw new ValidationError('وزن المهمة الصغيرة يجب أن يكون أكبر من صفر');
    const type = s.type === 'numeric' ? 'numeric' : 'binary';
    const target = type === 'numeric' ? Number(s.target) : null;
    if (type === 'numeric' && !(target > 0)) throw new ValidationError('الهدف الرقمي يجب أن يكون أكبر من صفر');
    return { title: requireText(s.title, 'عنوان المهمة الصغيرة', 200), type, target, weight };
  });
}

// إضافة سريعة: عنوان فقط. الباقي يُستكمل لاحقًا.
export function quickAddBank(state, title, idFactory, now = new Date().toISOString()) {
  const item = {
    id: idFactory(),
    type: 'idea',
    title: requireText(title, 'عنوان الفكرة', 200),
    description: '',
    notes: '',
    links: [],
    tags: [],
    status: 'draft',
    pinned: false,
    domainId: null,
    pointId: null,
    measure: 'binary',
    target: null,
    unit: '',
    weight: 1,
    subtasks: [],
    successCriteria: [],
    usedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  state.bank.push(item);
  return item;
}

export function updateBank(state, id, patch, now = new Date().toISOString()) {
  const item = findBank(state, id);
  if (patch.title !== undefined) item.title = requireText(patch.title, 'عنوان العنصر', 200);
  if (patch.type !== undefined) {
    if (!BANK_TYPES[patch.type]) throw new ValidationError('نوع العنصر غير معروف');
    item.type = patch.type;
  }
  if (patch.status !== undefined) {
    if (!BANK_STATUSES[patch.status]) throw new ValidationError('حالة العنصر غير معروفة');
    item.status = patch.status;
  }
  if (patch.description !== undefined) item.description = optionalText(patch.description);
  if (patch.notes !== undefined) item.notes = optionalText(patch.notes);
  if (patch.links !== undefined) item.links = sanitizeLinks(patch.links);
  if (patch.tags !== undefined) {
    item.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
  }
  if (patch.pinned !== undefined) item.pinned = Boolean(patch.pinned);
  if (patch.domainId !== undefined) item.domainId = patch.domainId || null;
  if (patch.pointId !== undefined) item.pointId = patch.pointId || null;
  if (patch.measure !== undefined) {
    if (!MEASURES.includes(patch.measure)) throw new ValidationError('نوع القياس غير معروف');
    item.measure = patch.measure;
  }
  if (patch.target !== undefined) {
    const t = patch.target === null || patch.target === '' ? null : Number(patch.target);
    if (t !== null && !(t > 0)) throw new ValidationError('الهدف يجب أن يكون أكبر من صفر');
    item.target = t;
  }
  if (patch.unit !== undefined) item.unit = optionalText(patch.unit, 40);
  if (patch.weight !== undefined) {
    const w = Number(patch.weight);
    if (!(w > 0)) throw new ValidationError('الوزن يجب أن يكون أكبر من صفر');
    item.weight = w;
  }
  if (patch.subtasks !== undefined) item.subtasks = sanitizeSubtasks(patch.subtasks);
  if (patch.successCriteria !== undefined) {
    item.successCriteria = patch.successCriteria.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  }
  item.updatedAt = now;
  return item;
}

// الأرشفة لا تحذف العنصر ولا أي نسخة منه أُضيفت إلى مستوى.
export function archiveBank(state, id, now = new Date().toISOString()) {
  const item = findBank(state, id);
  item.status = 'archived';
  item.updatedAt = now;
  return item;
}

// نسخة قالب جديدة من عنصر موجود (بدون ربط بالنسخة الأصلية).
export function cloneBankAsTemplate(state, id, idFactory, now = new Date().toISOString()) {
  const src = findBank(state, id);
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = idFactory();
  copy.title = `${src.title} (نسخة)`;
  copy.status = 'draft';
  copy.pinned = false;
  copy.usedCount = 0;
  copy.createdAt = now;
  copy.updatedAt = now;
  state.bank.push(copy);
  return copy;
}

export function deleteBank(state, id) {
  const item = findBank(state, id);
  // نسمح بالحذف فقط إذا لم تُستخدم، لأن النسخ تحتفظ بمرجع المصدر (sourceBankId).
  if (item.usedCount > 0) throw new ValidationError('العنصر استُخدم في مستوى؛ أرشفه بدل حذفه');
  state.bank = state.bank.filter((b) => b.id !== id);
}

export function filterBank(items, { query = '', type = '', status = '', showArchived = false } = {}) {
  const q = query.trim().toLowerCase();
  return items
    .filter((b) => showArchived || b.status !== 'archived' || status === 'archived')
    .filter((b) => !type || b.type === type)
    .filter((b) => !status || b.status === status)
    .filter((b) => {
      if (!q) return true;
      const hay = [b.title, b.description, b.notes, ...(b.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.createdAt < b.createdAt ? 1 : -1));
}
