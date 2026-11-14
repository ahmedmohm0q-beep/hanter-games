// نسخ احتياطي قابل للاستعادة: ملف JSON واحد يتضمن كل البيانات والمرفقات (الصور كـ data URL).
// لا يتضمن الملف رموز الدخول إلى السحابة، لأنها تُحفظ في مكان منفصل ولا تدخل الحالة.

import { ValidationError } from './money.js';
import { normalizeState, SCHEMA_VERSION } from './state.js';

export const BACKUP_FORMAT = 'personal-app-backup';
export const BACKUP_FORMAT_VERSION = 1;

export function exportBackup(state, now = new Date().toISOString()) {
  const envelope = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    contains: 'بيانات كاملة بما فيها المرفقات. لا تشارك هذا الملف مع أحد.',
    state,
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseBackup(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new ValidationError('الملف ليس JSON صالحًا');
  }
  if (!envelope || envelope.format !== BACKUP_FORMAT) {
    throw new ValidationError('هذا الملف ليس نسخة احتياطية من هذا التطبيق');
  }
  if (envelope.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new ValidationError('النسخة الاحتياطية أحدث من هذا التطبيق؛ حدّث التطبيق أولًا');
  }
  return normalizeState(envelope.state);
}

export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `personal-app-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
