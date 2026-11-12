// المال كأعداد صحيحة من أصغر وحدة (minor units). لا تُخزَّن أي قيمة مالية كـ float.
// الأسعار تُخزَّن كنص عشري ("3.6725") وتُحوَّل إلى كسر BigInt (بسط/مقام) عند الحساب.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const DEFAULT_CURRENCIES = [
  { code: 'AED', name: 'درهم إماراتي', decimals: 2 },
  { code: 'EGP', name: 'جنيه مصري', decimals: 2 },
  { code: 'USD', name: 'دولار أمريكي', decimals: 2 },
];

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

// يحوّل الأرقام العربية والهندية وفواصلها إلى الصيغة اللاتينية.
export function normalizeDigits(value) {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const eastern = '۰۱۲۳۴۵۶۷۸۹';
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(eastern.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

// يحلل مبلغًا نصيًا إلى عدد صحيح من أصغر وحدة.
export function parseMoney(input, decimals, { allowNegative = false } = {}) {
  const cleaned = normalizeDigits(input).trim().replace(/[\s,]/g, '');
  if (cleaned === '') throw new ValidationError('أدخل مبلغًا');
  const pattern = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(cleaned)) throw new ValidationError('صيغة المبلغ غير صحيحة');
  let [intPart, fracPart = ''] = cleaned.split('.');
  if (fracPart.length > decimals) {
    throw new ValidationError(`المبلغ يقبل ${decimals} خانات عشرية كحد أقصى`);
  }
  const negative = intPart.startsWith('-');
  if (negative) intPart = intPart.slice(1);
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const minor =
    BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPadded === '' ? '0' : fracPadded);
  if (minor > BigInt(MAX_SAFE_MINOR)) throw new ValidationError('المبلغ كبير جدًا');
  const value = Number(minor);
  return negative ? -value : value;
}

export function assertMinor(value, { allowNegative = false, label = 'المبلغ' } = {}) {
  if (!Number.isSafeInteger(value)) throw new ValidationError(`${label} يجب أن يكون عددًا صحيحًا`);
  if (!allowNegative && value <= 0) throw new ValidationError(`${label} يجب أن يكون أكبر من صفر`);
  return value;
}

// تنسيق للعرض فقط. الأرقام لاتينية لأنها الأوضح في المحاسبة.
export function formatMoney(minor, currency, decimals = 2) {
  const negative = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decimals > 0 ? `${grouped}.${frac}` : grouped;
  return `${negative ? '-' : ''}${body} ${currency}`;
}

// سعر الصرف كسر دقيق: 1 من العملة A = num/den من العملة B (بوحدات عشرية كاملة).
export function parseRate(text) {
  const cleaned = normalizeDigits(text).trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new ValidationError('سعر الصرف يجب أن يكون رقمًا موجبًا');
  const [intPart, fracPart = ''] = cleaned.split('.');
  const num = BigInt(intPart + fracPart);
  const den = 10n ** BigInt(fracPart.length);
  if (num === 0n) throw new ValidationError('سعر الصرف يجب أن يكون أكبر من صفر');
  return { num, den };
}

export function invertRate(rate) {
  return { num: rate.den, den: rate.num };
}

// تقريب نصف لأعلى للقيم السالبة والموجبة.
function roundDiv(numerator, denominator) {
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const sign = numerator < 0n ? -1n : 1n;
  const a = numerator < 0n ? -numerator : numerator;
  return (sign * ((2n * a + denominator) / (2n * denominator)));
}

// تحويل مبلغ بين عملتين باستخدام سعر كسري. النتيجة عدد صحيح بوحدة العملة الهدف.
export function convertMinor(minorFrom, fromDecimals, toDecimals, rate) {
  const numerator = BigInt(minorFrom) * rate.num * 10n ** BigInt(toDecimals);
  const denominator = rate.den * 10n ** BigInt(fromDecimals);
  const result = roundDiv(numerator, denominator);
  return Number(result);
}
