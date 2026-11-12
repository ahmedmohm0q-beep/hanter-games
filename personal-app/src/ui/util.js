// أدوات مشتركة للواجهة. كل نص يصل للـ DOM يمر عبر esc().

import { formatMoney } from '../core/money.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pct(fraction) {
  if (!Number.isFinite(fraction)) return '—';
  return `${Math.round(fraction * 100)}%`;
}

export function bar(fraction, label = '') {
  const w = Math.max(0, Math.min(100, Math.round((Number(fraction) || 0) * 100)));
  return `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w}" aria-label="${esc(label)}"><span style="width:${w}%"></span></div>`;
}

export function money(minor, currency, decimals = 2) {
  return `<bdi dir="ltr">${esc(formatMoney(minor, currency, decimals))}</bdi>`;
}

export function options(list, selected, { empty = null, labelKey = 'name', valueKey = 'id' } = {}) {
  const head = empty !== null ? `<option value="">${esc(empty)}</option>` : '';
  return head + list
    .map((item) => {
      const v = typeof item === 'string' ? item : item[valueKey];
      const l = typeof item === 'string' ? item : item[labelKey];
      return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
    })
    .join('');
}

export function emptyState(title, text = '', actionHtml = '') {
  return `<div class="empty"><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}${actionHtml}</div>`;
}

export function badge(text, tone = '') {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

// تحويل أسطر نصية إلى كائنات. مثال: "قراءة | binary | 2" أو "ستة كتب | numeric | 6 | 1"
export function parseLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

// تصغير الصورة قبل الحفظ حتى لا تتضخم قاعدة البيانات. الناتج JPEG بجودة معقولة.
export async function compressImage(file, maxSide = 800, quality = 0.8) {
  if (!file.type.startsWith('image/')) throw new Error('الملف ليس صورة');
  const dataUrl = await readFileAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('تعذّر فتح الصورة'));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', quality);
  if (out.length > 350_000) throw new Error('الصورة كبيرة بعد الضغط؛ اختر صورة أصغر');
  return out;
}

export function formData(form) {
  const data = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (k in data) {
      data[k] = [].concat(data[k], v);
    } else {
      data[k] = v;
    }
  }
  return data;
}

export const CHECK = '✓';
