// شكل البيانات الكامل وإنشاؤه والتحقق منه. كل شيء يُحفظ في كائن JSON واحد (انظر store).

import { DEFAULT_CURRENCIES, ValidationError } from './money.js';

export const SCHEMA_VERSION = 1;
export const DEFAULT_TARGET_LEVELS = 100;

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // بديل نادر للبيئات القديمة. ليس تشفيريًا، لكنه كافٍ لمعرّفات محلية فريدة.
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function defaultState(now = new Date().toISOString()) {
  const personalSpaceId = newId();
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    createdAt: now,
    profile: { name: '', bio: '', city: '', occupation: '', avatar: null },
    settings: {
      appName: 'تطوّري',
      // افتراضي: Bitwarden (خطة مجانية مناسبة للموبايل والكمبيوتر). الرابط غير مُتحقَّق منه من الوثائق الرسمية
      // في بيئة البناء؛ يمكن تغييره من الإعدادات في أي وقت.
      passwordManagerUrl: 'https://vault.bitwarden.com/',
      passwordManagerLabel: 'Bitwarden',
      displayCurrency: 'AED',
    },
    growth: { domains: [], points: [] },
    bank: [],
    plan: { targetLevels: DEFAULT_TARGET_LEVELS, levels: [] },
    awards: [],
    log: [],
    services: [],
    finance: {
      spaces: [
        { id: personalSpaceId, name: 'مالي الشخصي', kind: 'personal' },
      ],
      currencies: DEFAULT_CURRENCIES.map((c) => ({ ...c })),
      rates: [],
      accounts: [],
      categories: [],
      txns: [],
      budgets: [],
      debts: [],
      schedules: [],
      reconciliations: [],
      audit: [],
      activeSpaceId: personalSpaceId,
    },
  };
}

const ARRAY_KEYS = [
  ['bank'],
  ['awards'],
  ['log'],
  ['services'],
  ['growth', 'domains'],
  ['growth', 'points'],
  ['plan', 'levels'],
  ['finance', 'spaces'],
  ['finance', 'currencies'],
  ['finance', 'rates'],
  ['finance', 'accounts'],
  ['finance', 'categories'],
  ['finance', 'txns'],
  ['finance', 'budgets'],
  ['finance', 'debts'],
  ['finance', 'schedules'],
  ['finance', 'reconciliations'],
  ['finance', 'audit'],
];

// يتحقق من بنية البيانات المستوردة أو المحمّلة، ويُكمل الحقول الناقصة بقيم آمنة.
export function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('البيانات ليست كائنًا صالحًا');
  }
  if (typeof input.schemaVersion !== 'number' || input.schemaVersion > SCHEMA_VERSION) {
    throw new ValidationError('إصدار البيانات غير مدعوم من هذه النسخة من التطبيق');
  }
  const base = defaultState();
  const out = { ...base, ...input };
  out.profile = { ...base.profile, ...(input.profile || {}) };
  out.settings = { ...base.settings, ...(input.settings || {}) };
  out.growth = { ...base.growth, ...(input.growth || {}) };
  out.plan = { ...base.plan, ...(input.plan || {}) };
  out.finance = { ...base.finance, ...(input.finance || {}) };
  for (const path of ARRAY_KEYS) {
    let holder = out;
    for (let i = 0; i < path.length - 1; i++) holder = holder[path[i]];
    const key = path[path.length - 1];
    if (holder[key] === undefined) holder[key] = [];
    if (!Array.isArray(holder[key])) throw new ValidationError(`الحقل ${path.join('.')} يجب أن يكون قائمة`);
  }
  if (!Number.isSafeInteger(out.plan.targetLevels) || out.plan.targetLevels < 1) {
    throw new ValidationError('عدد المستويات المستهدف غير صالح');
  }
  if (out.finance.spaces.length === 0) {
    throw new ValidationError('لا توجد مساحة مالية');
  }
  if (!out.finance.spaces.some((s) => s.id === out.finance.activeSpaceId)) {
    out.finance.activeSpaceId = out.finance.spaces[0].id;
  }
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}
