// الوضع الداكن/الفاتح: تفضيل يخص الجهاز فقط ولا يدخل بيانات المستخدم ولا المزامنة.
// الافتراضي داكن. أي خطأ في التخزين (وضع خاص مثلًا) يرجّع الافتراضي بهدوء.

const KEY = 'personal-app.v1.theme';

export function currentTheme() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', value);
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // التخزين غير متاح: يبقى الوضع لهذه الجلسة فقط.
  }
  return value;
}

export function toggleTheme() {
  return applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

// الأيقونة تعرض الوضع الذي سينتقل إليه المستخدم عند الضغط.
export function themeIconSvg(theme) {
  if (theme === 'dark') {
    // الوضع الحالي فاتح، فالزر يعرض قمرًا للانتقال إلى الداكن.
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  }
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
}
