// التواريخ تُخزَّن كنص YYYY-MM-DD بلا وقت ولا منطقة زمنية. الحسابات تتم بـ UTC حتى لا تنزاح الأيام.

import { ValidationError } from './money.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const d = fromISO(value);
  return !Number.isNaN(d.getTime()) && toISO(d) === value;
}

export function assertISODate(value, label = 'التاريخ') {
  if (!isISODate(value)) throw new ValidationError(`${label} غير صحيح أو فارغ`);
  return value;
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

// اليوم حسب التقويم المحلي للجهاز (وليس UTC) لأن المستخدم يتعامل مع يومه المحلي.
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// إضافة شهور مع الحفاظ على يوم الشهر الأصلي (anchorDay) قدر الإمكان.
// 31 يناير + شهر = 28/29 فبراير، ثم 31 مارس (لا ينزاح الجدول إلى 28 للأبد).
export function addMonthsAnchored(iso, months, anchorDay = Number(iso.slice(8, 10))) {
  const [y, m] = iso.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month1 = ((total % 12) + 12) % 12 + 1;
  const day = Math.min(anchorDay, daysInMonth(year, month1));
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// الفرق بالأيام: b - a. موجب إذا كان b بعد a.
export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBetweenInclusive(iso, start, end) {
  return iso >= start && iso <= end;
}
