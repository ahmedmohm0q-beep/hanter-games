// إعدادات السحابة. هذا الملف يُنشر مع التطبيق، لذلك لا تضع فيه أي سر.
// - supabaseUrl: رابط مشروع Supabase (Project URL).
// - supabaseAnonKey: المفتاح العام (anon / publishable). آمن للواجهة لأن حماية البيانات تتم بـ RLS.
// ممنوع وضع service_role key هنا أو في أي ملف من هذا المستودع.
// إذا تُرك الحقلان فارغين يعمل التطبيق على هذا الجهاز فقط.
window.PERSONAL_APP_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
