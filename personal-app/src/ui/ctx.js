// حالة الواجهة غير المحفوظة (تبويبات، فلاتر، قائمة مفتوحة). لا تدخل البيانات المالية أو التقدم.
export const ui = {
  growthTab: 'profile',
  bank: { query: '', type: '', status: '', showArchived: false },
  money: { tab: 'accounts', query: '', type: '', accountId: '', reportFrom: '', reportTo: '' },
  services: { query: '', category: '', showArchived: false },
  currentExpanded: {},
  journeyExpanded: {},
};

// يُملأ من main.js عند الإقلاع: store و cloud.
export const ctx = { store: null, cloud: null };

export const PAGES = [
  { id: 'growth', label: 'تطوّري', icon: '🌱' },
  { id: 'bank', label: 'البنك', icon: '💡' },
  { id: 'journey', label: 'الرحلة', icon: '🗺️' },
  { id: 'current', label: 'المستوى', icon: '⭐' },
  { id: 'money', label: 'أموالي', icon: '💰' },
  { id: 'services', label: 'حساباتي', icon: '🔐' },
];
