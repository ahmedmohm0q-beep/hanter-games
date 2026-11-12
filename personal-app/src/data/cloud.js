// عميل Supabase بلا مكتبات: Auth عبر REST، وقراءة/حفظ عبر جدول user_state و RPC save_user_state.
// المفتاح العام (anon/publishable) فقط في الواجهة. أي مفتاح service_role ممنوع هنا.

const SESSION_KEY = 'personal-app.v1.session';

export class CloudError extends Error {
  constructor(message, code = 'error', status = 0) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
  }
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // التخزين قد يكون محجوبًا (وضع خاص). الجلسة تبقى في الذاكرة لهذه الجلسة فقط.
  }
}

export function createCloud({ url, anonKey, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const base = (url || '').replace(/\/+$/, '');
  const configured = Boolean(base && anonKey && /^https?:\/\//.test(base));
  let session = configured ? readSession() : null;

  const headers = (token) => ({
    apikey: anonKey,
    Authorization: `Bearer ${token || anonKey}`,
    'Content-Type': 'application/json',
  });

  async function parse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  }

  function toError(res, body) {
    const code = body && typeof body === 'object' ? body.code || body.error_code || body.error || '' : '';
    const message = (body && (body.message || body.error_description || body.msg)) || `خطأ ${res.status}`;
    return new CloudError(String(message), String(code || res.status), res.status);
  }

  async function refresh() {
    if (!session?.refresh_token) throw new CloudError('انتهت الجلسة؛ سجّل الدخول من جديد', 'auth', 401);
    const res = await fetchImpl(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: headers(null),
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const body = await parse(res);
    if (!res.ok) {
      session = null;
      writeSession(null);
      throw new CloudError('انتهت الجلسة؛ سجّل الدخول من جديد', 'auth', res.status);
    }
    saveAuthBody(body);
  }

  function saveAuthBody(body) {
    session = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + (body.expires_in || 3600) * 1000,
      user_id: body.user?.id,
      email: body.user?.email,
    };
    writeSession(session);
  }

  // طلب مع تجديد تلقائي للجلسة مرة واحدة عند 401.
  async function request(path, init = {}, retry = true) {
    if (!configured) throw new CloudError('السحابة غير مُعدّة', 'not_configured');
    if (!session) throw new CloudError('سجّل الدخول أولًا', 'auth', 401);
    if (session.expires_at - Date.now() < 60_000) await refresh();
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers(session.access_token), ...(init.headers || {}) },
    });
    if (res.status === 401 && retry) {
      await refresh();
      return request(path, init, false);
    }
    const body = await parse(res);
    if (!res.ok) throw toError(res, body);
    return body;
  }

  return {
    configured,
    get session() {
      return session;
    },
    get email() {
      return session?.email || null;
    },
    async signIn(email, password) {
      if (!configured) throw new CloudError('السحابة غير مُعدّة', 'not_configured');
      const res = await fetchImpl(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: headers(null),
        body: JSON.stringify({ email: String(email).trim(), password }),
      });
      const body = await parse(res);
      if (!res.ok) {
        throw new CloudError('البريد أو كلمة المرور غير صحيحة', 'auth', res.status);
      }
      saveAuthBody(body);
      return session;
    },
    signOut() {
      session = null;
      writeSession(null);
    },
    // يرجع { exists, version, lastRequestId, state }
    async fetchRemote() {
      const rows = await request('/rest/v1/user_state?select=version,last_request_id,state', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        return { exists: false, version: 0, lastRequestId: null, state: null };
      }
      const row = rows[0];
      return { exists: true, version: row.version, lastRequestId: row.last_request_id, state: row.state };
    },
    // يحفظ بشرط الإصدار المتوقع. يرمي CloudError بالكود P0409 عند التعارض.
    async saveRemote(expectedVersion, state, requestId) {
      const newVersion = await request('/rest/v1/rpc/save_user_state', {
        method: 'POST',
        body: JSON.stringify({ p_expected_version: expectedVersion, p_state: state, p_request_id: requestId }),
      });
      return Number(newVersion);
    },
  };
}
