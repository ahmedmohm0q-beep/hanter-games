import { ValidationError } from './money.js';

// الروابط تقبل http/https فقط، لمنع javascript: وغيره في الروابط المعروضة.
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function requireText(value, label, max = 300) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${label} مطلوب`);
  if (text.length > max) throw new ValidationError(`${label} أطول من ${max} حرف`);
  return text;
}

export function optionalText(value, max = 2000) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new ValidationError(`النص أطول من ${max} حرف`);
  return text;
}
