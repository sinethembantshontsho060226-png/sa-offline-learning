/*
 * api.js — the ONLY place that talks to the network. Every call here is
 * small, JSON, and optional: the app must work with every one of these
 * calls failing (student offline) or simply never being made until a
 * teacher/admin chooses to sync.
 */
const API = {
  async _authHeaders() {
    const session = await DB.kvGet("session");
    const headers = { "Content-Type": "application/json" };
    if (session && session.token) headers["Authorization"] = "Bearer " + session.token;
    return headers;
  },

  async _call(path, { method = "GET", body, timeoutMs = 7000 } = {}) {
    if (!navigator.onLine) throw new Error("offline");
    const headers = await this._authHeaders();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
      return data;
    } finally {
      clearTimeout(t);
    }
  },

  signup(payload) { return this._call("/api/auth/signup", { method: "POST", body: payload }); },
  login(payload) { return this._call("/api/auth/login", { method: "POST", body: payload }); },
  logout() { return this._call("/api/auth/logout", { method: "POST" }).catch(() => {}); },
  forgotPassword(email) { return this._call("/api/auth/forgot-password", { method: "POST", body: { email } }); },
  resetPassword(token, password) { return this._call("/api/auth/reset-password", { method: "POST", body: { token, password } }); },
  searchSchools(q) { return this._call("/api/schools?q=" + encodeURIComponent(q), { timeoutMs: 4000 }); },

  syncPull(since) { return this._call("/api/sync/pull?since=" + encodeURIComponent(since || ""), { timeoutMs: 15000 }); },
  syncPush(payload) { return this._call("/api/sync/push", { method: "POST", body: payload, timeoutMs: 15000 }); },

  async uploadFile(noteId, blob, filename) {
    if (!navigator.onLine) throw new Error("offline");
    const session = await DB.kvGet("session");
    const form = new FormData();
    form.append("file", blob, filename);
    const resp = await fetch(`/api/notes/${noteId}/upload`, {
      method: "POST",
      headers: { Authorization: "Bearer " + (session ? session.token : "") },
      body: form,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Upload failed");
    return data;
  },

  adminClaim(adminKey) { return this._call("/api/admin/claim", { method: "POST", body: { admin_key: adminKey } }); },
  adminStats() { return this._call("/api/admin/stats"); },
  adminUsers(q, cursor) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    return this._call("/api/admin/users?" + params.toString());
  },
  adminRemoveUser(id) { return this._call(`/api/admin/users/${id}/remove`, { method: "POST" }); },
  quizResults(quizId) { return this._call(`/api/quizzes/${quizId}/results`); },
};
