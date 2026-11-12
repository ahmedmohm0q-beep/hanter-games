// فهرس الحسابات الرقمية (حساباتي). هذا الفهرس لا يحفظ كلمات المرور ولا أكواد التحقق ولا الرموز.
// كلمة المرور تبقى في مدير كلمات مختص، والتطبيق يحفظ فقط اسم الخدمة ورابطها ومرجعًا نصيًا للعثور عليها.

import { ValidationError } from './money.js';
import { isSafeHttpUrl, requireText, optionalText } from './text.js';

// أسماء الحقول التي لا يجب أن تُقبل أبدًا في هذا الفهرس.
const FORBIDDEN_FIELDS = ['password', 'pass', 'pin', 'cvv', 'otp', 'secret', 'token', 'apiKey', 'recoveryCode', 'backupCode'];

function assertNoSecretFields(input) {
  const keys = Object.keys(input).map((k) => k.toLowerCase());
  const bad = FORBIDDEN_FIELDS.find((f) => keys.includes(f.toLowerCase()));
  if (bad) throw new ValidationError(`الحقل "${bad}" ممنوع هنا؛ احفظه في مدير كلمات المرور`);
}

function normalizeService(input) {
  assertNoSecretFields(input);
  if (!isSafeHttpUrl(input.url)) throw new ValidationError('رابط الموقع يجب أن يبدأ بـ http أو https');
  if (input.subscriptionScheduleId !== undefined && input.subscriptionScheduleId !== null && typeof input.subscriptionScheduleId !== 'string') {
    throw new ValidationError('مرجع الاشتراك غير صالح');
  }
  return {
    name: requireText(input.name, 'اسم الخدمة', 120),
    url: input.url.trim(),
    category: optionalText(input.category, 60),
    note: optionalText(input.note, 1000),
    managerRef: optionalText(input.managerRef, 200),
    subscriptionScheduleId: input.subscriptionScheduleId || null,
  };
}

export function addService(state, input, idFactory, now = new Date().toISOString()) {
  const data = normalizeService(input);
  const svc = { id: idFactory(), ...data, archived: false, createdAt: now, updatedAt: now };
  state.services.push(svc);
  return svc;
}

export function updateService(state, id, input, now = new Date().toISOString()) {
  const svc = state.services.find((s) => s.id === id);
  if (!svc) throw new ValidationError('الخدمة غير موجودة');
  const merged = normalizeService({ ...svc, ...input });
  Object.assign(svc, merged, { updatedAt: now });
  return svc;
}

export function setServiceArchived(state, id, archived, now = new Date().toISOString()) {
  const svc = state.services.find((s) => s.id === id);
  if (!svc) throw new ValidationError('الخدمة غير موجودة');
  svc.archived = Boolean(archived);
  svc.updatedAt = now;
  return svc;
}

export function filterServices(list, { query = '', category = '', showArchived = false } = {}) {
  const q = query.trim().toLowerCase();
  return list
    .filter((s) => showArchived || !s.archived)
    .filter((s) => !category || s.category === category)
    .filter((s) => {
      if (!q) return true;
      return [s.name, s.url, s.category, s.note, s.managerRef].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export function serviceCategories(list) {
  return [...new Set(list.map((s) => s.category).filter(Boolean))].sort();
}
