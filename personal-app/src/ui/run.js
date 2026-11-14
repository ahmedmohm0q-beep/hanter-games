// تشغيل إجراء داخل نموذج: عند النجاح تُغلق النافذة، وعند خطأ التحقق تظهر الرسالة داخل النموذج.
import { ValidationError } from '../core/money.js';
import { CloudError } from '../data/cloud.js';
import { closeModal, showFormError, toast } from './modal.js';

export function errMsg(e) {
  if (e instanceof ValidationError || e instanceof CloudError) return e.message;
  console.error(e);
  return 'حدث خطأ غير متوقع. لم يُحفظ شيء. ' + (e && e.message ? `(${e.message})` : '');
}

export function runForm(form, fn, { keepOpen = false, successMessage = 'تم الحفظ' } = {}) {
  try {
    fn();
    if (!keepOpen) closeModal();
    if (successMessage) toast(successMessage, 'ok');
    return true;
  } catch (e) {
    showFormError(form, errMsg(e));
    return false;
  }
}

export function runAction(fn, successMessage = '') {
  try {
    fn();
    if (successMessage) toast(successMessage, 'ok');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}
