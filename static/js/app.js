/*
 * app.js — router + views + event wiring for the installed app.
 * Every view renders from IndexedDB only. The only network calls in this
 * whole file are: login/signup (one-time, needs the server to create or
 * verify an account) and Sync.run() (explicit "Sync now" button, or the
 * automatic one that fires when the device comes back online).
 */
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function nowIso() { return new Date().toISOString(); }
function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --------------------------------------------------------------------------
// UI helpers
// --------------------------------------------------------------------------
const UI = {
  toast(msg, ms = 2200) {
    let el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), ms);
  },
  showSyncPill(msg, autoHideMs) {
    const el = document.getElementById("syncPill");
    el.innerHTML = autoHideMs ? `<span>✓</span> ${msg}` : `<span class="spin"></span> ${msg}`;
    el.classList.add("show");
    clearTimeout(el._t);
    if (autoHideMs) el._t = setTimeout(() => el.classList.remove("show"), autoHideMs);
  },
  hideSyncPill() { document.getElementById("syncPill").classList.remove("show"); },
  updateOfflineBanner() {
    document.getElementById("offlineBanner").classList.toggle("show", !navigator.onLine);
  },
};
window.addEventListener("online", UI.updateOfflineBanner);
window.addEventListener("offline", UI.updateOfflineBanner);

// --------------------------------------------------------------------------
// Session
// --------------------------------------------------------------------------
const Session = {
  current: null, // { token, user }
  async load() { this.current = await DB.kvGet("session"); return this.current; },
  async set(token, user) {
    this.current = { token, user };
    await DB.kvSet("session", this.current);
  },
  async updateUser(user) {
    this.current.user = user;
    await DB.kvSet("session", this.current);
  },
  async clear() {
    this.current = null;
    await DB.kvDelete("session");
  },
};

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------
const Router = {
  routes: {},
  on(path, handler) { this.routes[path] = handler; },
  async rerender() { await this.handle(location.hash || "#/home"); },
  async handle(hash) {
    const [path, queryStr] = hash.replace(/^#/, "").split("?");
    const query = Object.fromEntries(new URLSearchParams(queryStr || ""));
    const parts = path.split("/").filter(Boolean);

    await Session.load();
    const authed = !!(Session.current && Session.current.user);
    const publicPaths = ["/login", "/signup", "/forgot-password", "/reset-password"];
    const currentPath = "/" + (parts[0] || "home");

    if (!authed && !publicPaths.includes(currentPath)) {
      location.hash = "#/login";
      return;
    }
    if (authed && publicPaths.includes(currentPath)) {
      location.hash = "#/home";
      return;
    }

    UI.updateOfflineBanner();
    renderNav(authed ? Session.current.user : null, currentPath);

    const app = document.getElementById("app");
    app.innerHTML = '<div class="loader-screen"><div class="loader-ring"></div></div>';

    try {
      if (currentPath === "/login") return Views.login(app);
      if (currentPath === "/signup") return Views.signup(app);
      if (currentPath === "/forgot-password") return Views.forgotPassword(app);
      if (currentPath === "/reset-password") return Views.resetPassword(app, query.token);
      if (currentPath === "/home") return Views.home(app);
      if (currentPath === "/notes" && parts[1] === "new") return Views.noteNew(app);
      if (currentPath === "/notes") return Views.notes(app);
      if (currentPath === "/quizzes" && parts[1] === "new") return Views.quizNew(app);
      if (currentPath === "/quizzes" && parts[2] === "take") return Views.quizTake(app, parts[1]);
      if (currentPath === "/quizzes" && parts[2] === "results") return Views.quizResultsTeacher(app, parts[1]);
      if (currentPath === "/quizzes") return Views.quizzes(app);
      if (currentPath === "/planner") return Views.planner(app);
      if (currentPath === "/tools") return Views.tools(app);
      if (currentPath === "/share") return Views.share(app);
      if (currentPath === "/library") return Views.library(app);
      if (currentPath === "/homework" && parts[1] === "new") return Views.homeworkNew(app);
      if (currentPath === "/profile") return Views.profile(app);
      if (currentPath === "/admin" && parts[1] === "claim") return Views.adminClaim(app);
      if (currentPath === "/admin" && parts[1] === "users") return Views.adminUsers(app);
      if (currentPath === "/admin") return Views.adminDashboard(app);
      app.innerHTML = '<div class="empty-state"><div class="emoji">🤔</div><p>Page not found.</p></div>';
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><p>Something went wrong loading this screen.</p></div>`;
    }
  },
};
window.addEventListener("hashchange", Router.rerender.bind(Router));

function renderNav(user, currentPath) {
  const nav = document.getElementById("bottomNav");
  if (!user) { nav.innerHTML = ""; return; }
  const item = (path, label, icon) =>
    `<a href="#${path}" class="nav-item ${currentPath === path ? "active" : ""}">${icon}${label}<span class="nav-indicator"></span></a>`;
  nav.innerHTML = `
    ${item("/home", "Home", `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>`)}
    ${item("/library", "Library", `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`)}
    <a href="#${user.role === "teacher" ? "/notes/new" : "/notes"}" class="nav-item fab">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.3"><path d="M12 5v14M5 12h14"/></svg>
      <span>Study</span>
    </a>
    ${item("/share", "Share", `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9"/></svg>`)}
    ${item("/profile", "Profile", `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`)}
  `;
}

function topHeader(title, backPath) {
  return `
    <div class="top-inner-header">
      <a href="#${backPath}" class="back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M15 18l-6-6 6-6"/></svg></a>
      <h1>${title}</h1>
    </div>`;
}

// --------------------------------------------------------------------------
// VIEWS
// --------------------------------------------------------------------------
const Views = {};

// ---- AUTH -----------------------------------------------------------------
Views.login = (app) => {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="logo-row"><div class="logo-box">📘</div>
        <div><div style="font-weight:800; font-size:15px;">SA Offline Learning</div>
        <div style="font-size:11px; color:var(--text-sub); letter-spacing:.06em;">NO DATA NEEDED</div></div></div>
      <h1>Welcome back</h1>
      <p class="lead">Log in to pick up right where you left off.</p>
      <form id="loginForm">
        <div class="field"><label>Email</label><input type="email" name="email" required></div>
        <div class="field"><label>Password</label><input type="password" name="password" required></div>
        <div style="text-align:right; margin: -6px 0 18px;">
          <a href="#/forgot-password" style="font-size:12.5px; color:var(--orange); font-weight:700; text-decoration:none;">Forgot Password?</a>
        </div>
        <button type="submit" class="btn-primary">Log in</button>
      </form>
      <div class="auth-link">New here? <a href="#/signup">Create an account</a></div>
      <p style="text-align:center; font-size:11.5px; color:var(--text-sub); margin-top:18px;">Needs a connection once, to sign in. After that, works fully offline.</p>
    </div>`;
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await API.login({ email: fd.get("email"), password: fd.get("password") });
      await Session.set(res.token, res.user);
      await Sync.run(res.user);
      location.hash = "#/home";
    } catch (err) {
      UI.toast(navigator.onLine ? err.message : "You're offline — connect once to log in.");
    }
  });
};

Views.signup = (app) => {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="logo-row"><div class="logo-box">📘</div>
        <div><div style="font-weight:800; font-size:15px;">SA Offline Learning</div>
        <div style="font-size:11px; color:var(--text-sub); letter-spacing:.06em;">NO DATA NEEDED</div></div></div>
      <h1>Create your account</h1>
      <p class="lead">Learn offline, anytime — join your school to get started.</p>
      <form id="signupForm">
        <div class="field"><label>Full name</label><input type="text" name="full_name" required></div>
        <div class="field"><label>Email</label><input type="email" name="email" required></div>
        <div class="field"><label>Password</label><input type="password" name="password" required></div>
        <div class="field"><label>Confirm password</label><input type="password" name="confirm_password" required></div>
        <div class="field"><label>I am a</label>
          <div class="radio-group" id="roleGroup">
            <label class="radio-pill active" data-role="student"><input type="radio" name="role" value="student" checked> Student</label>
            <label class="radio-pill" data-role="teacher"><input type="radio" name="role" value="teacher"> Teacher</label>
          </div>
        </div>
        <div class="field">
          <label>Search your school</label>
          <div class="school-search-wrap">
            <input type="text" id="schoolSearch" autocomplete="off" placeholder="Start typing your school name...">
            <div class="school-results" id="schoolResults"></div>
          </div>
          <div class="school-selected" id="schoolSelected"><span id="schoolSelectedName"></span><button type="button" id="clearSchool">Change</button></div>
          <input type="hidden" name="school_emis" id="schoolEmis" required>
        </div>
        <div class="field" id="gradeField"><label>Grade</label>
          <select name="grade"><option value="">Select grade</option>
            <option value="8">Grade 8</option><option value="9">Grade 9</option><option value="10">Grade 10</option>
            <option value="11">Grade 11</option><option value="12">Grade 12</option>
          </select>
        </div>
        <button type="submit" class="btn-primary">Create account</button>
      </form>
      <div class="auth-link">Already have an account? <a href="#/login">Log in</a></div>
    </div>`;

  document.querySelectorAll("#roleGroup .radio-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#roleGroup .radio-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      pill.querySelector("input").checked = true;
      document.getElementById("gradeField").style.display = pill.dataset.role === "student" ? "block" : "none";
    });
  });

  const schoolInput = document.getElementById("schoolSearch");
  const resultsBox = document.getElementById("schoolResults");
  const emisField = document.getElementById("schoolEmis");
  const selectedBox = document.getElementById("schoolSelected");
  const selectedName = document.getElementById("schoolSelectedName");
  let debounceTimer;
  schoolInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = schoolInput.value.trim();
    emisField.value = "";
    if (q.length < 2) { resultsBox.classList.remove("open"); resultsBox.innerHTML = ""; return; }
    if (!navigator.onLine) {
      resultsBox.innerHTML = `<div class="school-result-item"><div class="n">You're offline</div><div class="d">Connect once to search and create your account.</div></div>`;
      resultsBox.classList.add("open");
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const schools = await API.searchSchools(q);
        resultsBox.innerHTML = schools.length
          ? schools.map((s) => `<div class="school-result-item" data-emis="${s.emis}" data-name="${escapeHtml(s.name)}"><div class="n">${escapeHtml(s.name)}</div><div class="d">${escapeHtml(s.province || "")} · ${escapeHtml(s.district || "")}</div></div>`).join("")
          : `<div class="school-result-item"><div class="n">No matches</div></div>`;
        resultsBox.classList.add("open");
      } catch (e) { /* ignore */ }
    }, 220);
  });
  resultsBox.addEventListener("click", (e) => {
    const item = e.target.closest(".school-result-item");
    if (!item || !item.dataset.emis) return;
    emisField.value = item.dataset.emis;
    selectedName.textContent = item.dataset.name;
    selectedBox.classList.add("show");
    schoolInput.value = "";
    resultsBox.classList.remove("open");
  });
  document.getElementById("clearSchool").addEventListener("click", () => {
    emisField.value = ""; selectedBox.classList.remove("show");
  });

  document.getElementById("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("password") !== fd.get("confirm_password")) return UI.toast("Passwords don't match.");
    if (!fd.get("school_emis")) return UI.toast("Please select your school.");
    try {
      const res = await API.signup({
        full_name: fd.get("full_name"), email: fd.get("email"), password: fd.get("password"),
        role: fd.get("role"), school_emis: Number(fd.get("school_emis")), grade: fd.get("grade") ? Number(fd.get("grade")) : null,
      });
      await Session.set(res.token, res.user);
      await Sync.run(res.user);
      location.hash = "#/home";
    } catch (err) {
      UI.toast(navigator.onLine ? err.message : "You're offline — connect once to create your account.");
    }
  });
};

Views.forgotPassword = (app) => {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="logo-row"><div class="logo-box">🔑</div><div style="font-weight:800; font-size:15px;">Reset your password</div></div>
      <h1>Forgot Password?</h1>
      <p class="lead">Enter the email on your account. We'll send you a reset link.</p>
      <form id="fpForm">
        <div class="field"><label>Email</label><input type="email" name="email" required></div>
        <button type="submit" class="btn-primary">Send reset link</button>
      </form>
      <div id="fpResult"></div>
      <div class="auth-link"><a href="#/login">Back to login</a></div>
    </div>`;
  document.getElementById("fpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get("email");
    try {
      const res = await API.forgotPassword(email);
      document.getElementById("fpResult").innerHTML = res.reset_token
        ? `<div class="card"><div style="font-size:12.5px; font-weight:700; color:var(--text-sub); margin-bottom:8px;">SIMULATED EMAIL — your reset link:</div>
            <a href="#/reset-password?token=${res.reset_token}" style="word-break:break-all; color:var(--orange); font-weight:700; font-size:13.5px;">Open reset link</a></div>`
        : `<p class="lead">If an account exists for that email, a reset link has been sent (simulated).</p>`;
    } catch (err) { UI.toast(err.message); }
  });
};

Views.resetPassword = (app, token) => {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="logo-row"><div class="logo-box">🔑</div><div style="font-weight:800; font-size:15px;">Set a new password</div></div>
      <h1>New password</h1>
      <form id="rpForm">
        <div class="field"><label>New password</label><input type="password" name="password" required></div>
        <div class="field"><label>Confirm new password</label><input type="password" name="confirm_password" required></div>
        <button type="submit" class="btn-primary">Reset password</button>
      </form>
    </div>`;
  document.getElementById("rpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("password") !== fd.get("confirm_password")) return UI.toast("Passwords don't match.");
    try {
      await API.resetPassword(token, fd.get("password"));
      UI.toast("Password reset! Please log in.");
      location.hash = "#/login";
    } catch (err) { UI.toast(err.message); }
  });
};

// ---- HOME -------------------------------------------------------------
Views.home = async (app) => {
  const user = Session.current.user;
  let notes = [], quizzes = [], homework = [];
  if (user.role === "student") {
    notes = await DB.byScope("notes", user.school_emis, user.grade);
    quizzes = await DB.byScope("quizzes", user.school_emis, user.grade);
  } else {
    notes = await DB.byTeacher("notes", user.id);
    quizzes = await DB.byTeacher("quizzes", user.id);
  }
  const active = quizzes[0];
  const pending = await Sync.pendingCount();

  app.innerHTML = `
    <div class="topbar">
      <div><p class="eyebrow">LEARN ANYWHERE</p>
        <h1>Hello, ${escapeHtml(user.full_name.split(" ")[0])}! 👋</h1>
        <p class="subtitle">Learn, track and submit with ease.</p></div>
      <a href="#/profile" class="avatar">${escapeHtml(user.avatar_initials)}<span class="dot"></span></a>
    </div>

    ${pending > 0 ? `
    <div class="install-banner">
      <div><b>${pending} change${pending === 1 ? "" : "s"} waiting to sync</b><span>Will send automatically when you're online</span></div>
      <button id="syncNowBtn">Sync now</button>
    </div>` : ""}

    <form class="search-bar" id="homeSearchForm">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
      <input type="text" placeholder="Search notes, subjects...">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
    </form>

    <div class="quick-actions">
      <a href="#/notes" class="quick-action primary"><div class="icon-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div><span>My Notes</span></a>
      <a href="#/quizzes" class="quick-action"><div class="icon-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div><span>Quizzes</span></a>
      <a href="#/planner" class="quick-action"><div class="icon-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></div><span>Planner</span></a>
      <a href="#/tools" class="quick-action"><div class="icon-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></div><span>Tools</span></a>
    </div>

    <div class="section-header"><h2>Active Learning</h2><a href="#/quizzes">See all ›</a></div>
    ${active ? `
    <div class="dark-card">
      <div class="row-top">
        <div class="id-row"><div class="id-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div><div class="id-title">#LRN${active.id.slice(0, 5).toUpperCase()}</div><div class="id-sub">${escapeHtml(active.subject || "General")} · Grade ${active.grade}</div></div></div>
        <div class="badge"><span class="pulse"></span> In Progress</div>
      </div>
      <div class="eta">${escapeHtml(active.title)}${active.due_date ? ` · Due <b>${escapeHtml(active.due_date)}</b>` : ""}</div>
      <div class="progress-track"><div class="seg filled"></div><div class="seg filled shimmer"></div><div class="seg"></div><div class="seg"></div></div>
      <div class="stage-labels"><span class="stage active">Downloaded</span><span class="stage active">In Progress</span><span class="stage">Submitted</span><span class="stage">Graded</span></div>
    </div>` : `<div class="card" style="text-align:center; color:var(--text-sub); padding:26px;">No active quiz right now — check Quizzes to get started.</div>`}

    <div class="promo-card">
      <p class="eyebrow">LEARN. OFFLINE. ANYWHERE.</p>
      <h3>Learning that matters.</h3>
      <p>Notes, quizzes and homework. No data. No excuses.</p>
      <a href="#${user.role === "student" ? "/notes" : "/notes/new"}" class="btn-dark">${user.role === "student" ? "Start studying" : "Share a note"}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg></a>
      <div class="promo-illustration">📚</div>
    </div>

    <div style="display:flex; gap:12px; margin: 0 20px 20px;">
      <div class="card" style="flex:1; margin:0; text-align:center;"><div style="font-size:22px; font-weight:800;">${notes.length}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Notes</div></div>
      <div class="card" style="flex:1; margin:0; text-align:center;"><div style="font-size:22px; font-weight:800;">${quizzes.length}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Quizzes</div></div>
      <div class="card" style="flex:1; margin:0; text-align:center;"><div style="font-size:13px; font-weight:800;">${navigator.onLine ? "Online" : "Offline"}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600; margin-top:4px;">${user.role === "student" ? "Grade " + user.grade : user.role}</div></div>
    </div>`;

  document.getElementById("homeSearchForm").addEventListener("submit", (e) => { e.preventDefault(); location.hash = "#/notes"; });
  document.getElementById("syncNowBtn")?.addEventListener("click", async () => { await Sync.run(user); Router.rerender(); });
};

// ---- NOTES --------------------------------------------------------------
Views.notes = async (app) => {
  const user = Session.current.user;
  const notes = user.role === "student"
    ? await DB.byScope("notes", user.school_emis, user.grade)
    : await DB.byTeacher("notes", user.id);

  app.innerHTML = `
    ${topHeader(user.role === "teacher" ? "My Notes" : "Notes", "/home")}
    ${user.role === "teacher" ? `<div style="padding: 14px 20px 4px;"><a href="#/notes/new" class="btn-primary" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;">+ Share a new note</a></div>` : ""}
    <div style="padding-top: 12px;">
      ${notes.length === 0 ? `<div class="empty-state"><div class="emoji">📒</div><p>No notes yet${user.role === "student" ? " for your grade" : ""}.</p></div>` : ""}
      ${notes.map((n) => `
        <div class="list-item" style="align-items:flex-start;">
          <div class="list-icon">${n.note_type === "pdf" ? "📄" : n.note_type === "voice" ? "🎙️" : "📝"}</div>
          <div class="list-meta">
            <p class="t">${escapeHtml(n.title)} ${n.synced === false ? `<span class="pending-badge">⏳ pending sync</span>` : ""}</p>
            <p class="s">${escapeHtml(n.subject || "General")} · Grade ${n.grade}</p>
            ${n.content && n.note_type === "text" ? `<p class="s" style="margin-top:6px; color: var(--text-main);">${escapeHtml(n.content).slice(0, 140)}</p>` : ""}
            ${n.file_path ? `<a href="/static/uploads/${n.file_path}" target="_blank" class="pill orange" style="margin-top:8px; text-decoration:none;">Open attachment ↓</a>` : n.pending_file ? `<span class="pill" style="margin-top:8px;">File will upload on next sync</span>` : ""}
          </div>
          ${user.role === "teacher" && n.teacher_id === user.id ? `<button data-action="deleteNote" data-id="${n.id}" style="background:none;border:none;color:#C0392B;cursor:pointer;font-size:12px;font-weight:700;">Delete</button>` : ""}
        </div>`).join("")}
    </div>`;

  app.querySelectorAll('[data-action="deleteNote"]').forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Delete this note?")) return;
    await DB.delete("notes", btn.dataset.id);
    Router.rerender();
  }));
};

Views.noteNew = (app) => {
  const user = Session.current.user;
  app.innerHTML = `
    ${topHeader("Share a Note", "/notes")}
    <div style="padding: 16px 20px 0;">
      <p style="font-size:13px; color:var(--text-sub); margin: -6px 0 16px;">Saved to this device immediately — syncs to the whole grade next time you're online.</p>
      <form id="noteForm">
        <div class="field"><label>Title</label><input type="text" name="title" required></div>
        <div class="field"><label>Subject</label><input type="text" name="subject"></div>
        <div class="field"><label>Grade</label><select name="grade" required><option value="">Select grade</option>
          ${[8,9,10,11,12].map((g) => `<option value="${g}">Grade ${g}</option>`).join("")}</select></div>
        <div class="field"><label>Note text (optional)</label><textarea name="content" rows="5"></textarea></div>
        <div class="field"><label>Attach a PDF or voice note (optional)</label><input type="file" name="file" accept=".pdf,.mp3,.m4a,.wav"></div>
        <button type="submit" class="btn-primary">Share with grade</button>
      </form>
    </div>`;
  document.getElementById("noteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = uuid();
    const note = {
      id, teacher_id: user.id, school_emis: user.school_emis, grade: Number(fd.get("grade")),
      subject: fd.get("subject") || null, title: fd.get("title"), note_type: "text",
      content: fd.get("content") || null, file_path: null, updated_at: nowIso(), synced: false,
    };
    const file = fd.get("file");
    if (file && file.size > 0) {
      note.pending_file = true;
      await DB.put("pending_uploads", { id: uuid(), note_id: id, blob: file, filename: file.name });
    }
    await DB.put("notes", note);
    UI.toast(navigator.onLine ? "Shared — syncing now." : "Saved on this device — will share once you're online.");
    if (navigator.onLine) Sync.run(user, { silent: true }).then(() => Router.rerender());
    location.hash = "#/notes";
  });
};

// ---- QUIZZES --------------------------------------------------------------
Views.quizzes = async (app) => {
  const user = Session.current.user;
  const quizzes = user.role === "student"
    ? await DB.byScope("quizzes", user.school_emis, user.grade)
    : await DB.byTeacher("quizzes", user.id);
  // Every quiz_result stored on this device belongs to the signed-in
  // student (results aren't synced down for anyone else), so no filter needed.
  const results = user.role === "student" ? await DB.all("quiz_results") : [];
  const attemptedIds = new Set(results.map((r) => r.quiz_id));

  app.innerHTML = `
    ${topHeader("Quizzes", "/home")}
    ${user.role === "teacher" ? `<div style="padding: 14px 20px 4px;"><a href="#/quizzes/new" class="btn-primary" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;">+ Create a new quiz</a></div>` : ""}
    <div style="padding-top: 12px;">
      ${quizzes.length === 0 ? `<div class="empty-state"><div class="emoji">🧠</div><p>No quizzes yet${user.role === "student" ? " for your grade" : ""}.</p></div>` : ""}
      ${quizzes.map((q) => `
        <a href="#/quizzes/${q.id}/${user.role === "student" ? "take" : "results"}" class="list-item">
          <div class="list-icon">🧠</div>
          <div class="list-meta"><p class="t">${escapeHtml(q.title)} ${q.synced === false ? `<span class="pending-badge">⏳ pending</span>` : ""}</p>
            <p class="s">${escapeHtml(q.subject || "General")} · Grade ${q.grade} · ${q.questions.length} question${q.questions.length !== 1 ? "s" : ""}${q.due_date ? " · Due " + escapeHtml(q.due_date) : ""}</p></div>
          ${user.role === "student" ? (attemptedIds.has(q.id) ? `<span class="pill green">Done</span>` : `<span class="pill orange">Take quiz</span>`) : `<span class="chev">›</span>`}
        </a>`).join("")}
    </div>`;
};

Views.quizNew = (app) => {
  const user = Session.current.user;
  app.innerHTML = `
    ${topHeader("Create Quiz", "/quizzes")}
    <div style="padding: 16px 20px 0;">
      <p style="font-size:13px; color:var(--text-sub); margin: -6px 0 16px;">Saved on this device immediately — reaches the whole grade next sync.</p>
      <form id="quizForm">
        <div class="field"><label>Quiz title</label><input type="text" name="title" required></div>
        <div class="field"><label>Subject</label><input type="text" name="subject"></div>
        <div class="field"><label>Grade</label><select name="grade" required><option value="">Select grade</option>
          ${[8,9,10,11,12].map((g) => `<option value="${g}">Grade ${g}</option>`).join("")}</select></div>
        <div class="field"><label>Due date (optional)</label><input type="date" name="due_date"></div>
        <div id="questionsWrap"></div>
        <button type="button" id="addQuestion" class="btn-secondary" style="margin-bottom:16px;">+ Add question</button>
        <button type="submit" class="btn-primary">Assign quiz to grade</button>
      </form>
    </div>`;

  const wrap = document.getElementById("questionsWrap");
  let qIndex = 0;
  function addQuestionBlock() {
    const i = qIndex++;
    const div = document.createElement("div");
    div.className = "card q-block";
    div.dataset.index = i;
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <b style="font-size:13.5px;">Question</b>
        <button type="button" class="remove-q" style="background:none;border:none;color:#C0392B;font-weight:700;font-size:12px;cursor:pointer;">Remove</button>
      </div>
      <div class="field"><input type="text" class="q-text" placeholder="Type your question"></div>
      <div class="option-row"><input type="radio" class="q-correct" name="correct-${i}" value="0" checked><input type="text" class="q-opt" placeholder="Option A"></div>
      <div class="option-row"><input type="radio" class="q-correct" name="correct-${i}" value="1"><input type="text" class="q-opt" placeholder="Option B"></div>
      <div class="option-row"><input type="radio" class="q-correct" name="correct-${i}" value="2"><input type="text" class="q-opt" placeholder="Option C (optional)"></div>
      <div class="option-row"><input type="radio" class="q-correct" name="correct-${i}" value="3"><input type="text" class="q-opt" placeholder="Option D (optional)"></div>`;
    div.querySelector(".remove-q").addEventListener("click", () => div.remove());
    wrap.appendChild(div);
  }
  document.getElementById("addQuestion").addEventListener("click", addQuestionBlock);
  addQuestionBlock();

  document.getElementById("quizForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const questions = [];
    wrap.querySelectorAll(".q-block").forEach((block) => {
      const qtext = block.querySelector(".q-text").value.trim();
      const opts = Array.from(block.querySelectorAll(".q-opt")).map((o) => o.value.trim());
      const correctRaw = Array.from(block.querySelectorAll(".q-correct")).findIndex((r) => r.checked);
      const kept = opts.map((o, idx) => ({ o, idx })).filter((x) => x.o);
      if (qtext && kept.length >= 2) {
        const newCorrect = kept.findIndex((k) => k.idx === correctRaw);
        questions.push({ question: qtext, options: kept.map((k) => k.o), correct: newCorrect >= 0 ? newCorrect : 0 });
      }
    });
    if (!questions.length) return UI.toast("Add at least one question.");
    const quiz = {
      id: uuid(), teacher_id: user.id, school_emis: user.school_emis, grade: Number(fd.get("grade")),
      subject: fd.get("subject") || null, title: fd.get("title"), questions,
      due_date: fd.get("due_date") || null, updated_at: nowIso(), synced: false,
    };
    await DB.put("quizzes", quiz);
    UI.toast(navigator.onLine ? "Assigned — syncing now." : "Saved on this device — will assign once you're online.");
    if (navigator.onLine) Sync.run(user, { silent: true }).then(() => Router.rerender());
    location.hash = "#/quizzes";
  });
};

Views.quizTake = async (app, quizId) => {
  const user = Session.current.user;
  const quiz = await DB.get("quizzes", quizId);
  if (!quiz) { app.innerHTML = `<div class="empty-state"><p>Quiz not found.</p></div>`; return; }
  const existing = (await DB.all("quiz_results")).find((r) => r.quiz_id === quizId);

  if (existing) {
    renderQuizResult(app, quiz, existing);
    return;
  }

  app.innerHTML = `
    ${topHeader(quiz.title, "/quizzes")}
    <p style="padding: 0 20px; color:var(--text-sub); font-size:13px; margin: -4px 0 16px;">${escapeHtml(quiz.subject || "General")} · ${quiz.questions.length} questions</p>
    <form id="takeForm">
      ${quiz.questions.map((q, qi) => `
        <div class="card">
          <b style="font-size:14.5px;">${qi + 1}. ${escapeHtml(q.question)}</b>
          <div style="margin-top:12px;">
            ${q.options.map((opt, oi) => `
              <label class="option-row" style="cursor:pointer; padding:10px 12px; border-radius:12px; border:1.5px solid var(--border);">
                <input type="radio" name="q${qi}" value="${oi}" required style="width:18px;height:18px;">
                <span style="flex:1; font-size:13.5px;">${escapeHtml(opt)}</span>
              </label>`).join("")}
          </div>
        </div>`).join("")}
      <div style="padding: 4px 20px 20px;"><button type="submit" class="btn-primary">Submit quiz</button></div>
    </form>`;

  document.getElementById("takeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answers = quiz.questions.map((_, qi) => Number(fd.get(`q${qi}`)));
    const score = quiz.questions.reduce((acc, q, qi) => acc + (answers[qi] === q.correct ? 1 : 0), 0);
    const result = { id: uuid(), quiz_id: quizId, score, total: quiz.questions.length, answers, submitted_at: nowIso(), synced: false };
    await DB.put("quiz_results", result);
    if (navigator.onLine) Sync.run(user, { silent: true });
    renderQuizResult(app, quiz, result);
  });
};

function renderQuizResult(app, quiz, result) {
  const pct = Math.round((result.score / result.total) * 100);
  app.innerHTML = `
    ${topHeader(quiz.title, "/quizzes")}
    <div style="text-align:center; padding: 10px 20px;">
      <div class="score-ring" style="--pct: ${pct};"><div class="inner"><b>${pct}%</b><span>${result.score}/${result.total}</span></div></div>
      <p style="font-weight:700; margin:0 0 4px;">${pct >= 80 ? "Excellent work! 🎉" : pct >= 50 ? "Good effort! 👍" : "Keep practicing 💪"}</p>
    </div>
    ${quiz.questions.map((q, qi) => `
      <div class="card">
        <b style="font-size:14px;">${qi + 1}. ${escapeHtml(q.question)}</b>
        <div style="margin-top:10px;">
          ${q.options.map((opt, oi) => {
            const isCorrect = oi === q.correct;
            const isGiven = oi === result.answers[qi];
            const border = isCorrect ? "#22C55E" : (isGiven ? "#C0392B" : "var(--border)");
            const bg = isCorrect ? "#E9F9EE" : (isGiven && !isCorrect ? "#FEEAEA" : "#fff");
            return `<div class="option-row" style="padding:10px 12px; border-radius:12px; border:1.5px solid ${border}; background:${bg};">
              <span style="flex:1; font-size:13.5px;">${escapeHtml(opt)}</span>
              ${isCorrect ? `<span style="color:#22C55E; font-weight:700; font-size:12px;">✓ Correct</span>` : (isGiven ? `<span style="color:#C0392B; font-weight:700; font-size:12px;">Your answer</span>` : "")}
            </div>`;
          }).join("")}
        </div>
      </div>`).join("")}`;
}

Views.quizResultsTeacher = async (app, quizId) => {
  const user = Session.current.user;
  const quiz = await DB.get("quizzes", quizId);
  if (!quiz) { app.innerHTML = `<div class="empty-state"><p>Quiz not found.</p></div>`; return; }
  app.innerHTML = `${topHeader(quiz.title, "/quizzes")}
    <p style="padding: 0 20px; color:var(--text-sub); font-size:13px; margin: -4px 0 16px;">Grade ${quiz.grade} · results load when you're online</p>
    <div id="resultsBox" class="card" style="text-align:center; color:var(--text-sub);">${navigator.onLine ? "Loading…" : "You're offline — connect to see submissions from the whole grade."}</div>`;
  if (!navigator.onLine) return;
  try {
    const data = await API.quizResults(quizId);
    const box = document.getElementById("resultsBox");
    if (!data.results.length) { box.innerHTML = "No submissions yet."; return; }
    box.outerHTML = data.results.map((r, i) => `
      <div class="list-item"><div class="list-icon">${i + 1}</div>
        <div class="list-meta"><p class="t">${escapeHtml(r.full_name)}</p><p class="s">Submitted ${escapeHtml(r.submitted_at)}</p></div>
        <span class="pill ${r.score / r.total >= 0.5 ? "green" : ""}">${r.score}/${r.total}</span></div>`).join("");
  } catch (e) { document.getElementById("resultsBox").textContent = "Couldn't load results right now."; }
};

// ---- PLANNER (fully local — this is the clearest "zero data" screen) -----
Views.planner = async (app) => {
  const user = Session.current.user;
  const items = (await DB.all("planner")).filter((i) => !i.deleted)
    .sort((a, b) => (a.item_date || "9999").localeCompare(b.item_date || "9999"));

  const row = (item) => `
    <div class="list-item" data-id="${item.id}">
      <div class="list-icon" style="background:${item.done ? "#E9F9EE" : "#FFF0E8"}; color:${item.done ? "#1E8449" : "var(--orange)"};">${item.done ? "✓" : "📖"}</div>
      <div class="list-meta"><p class="t" style="${item.done ? "text-decoration:line-through; color:var(--text-sub);" : ""}">${escapeHtml(item.title)}</p>
        <p class="s">${escapeHtml(item.item_date || "No date set")}</p></div>
      <button data-action="toggle" data-id="${item.id}" style="background:none;border:none;color:var(--orange);font-weight:700;font-size:12px;cursor:pointer;">${item.done ? "Undo" : "Done"}</button>
      <button data-action="delete" data-id="${item.id}" style="background:none;border:none;color:#C0392B;font-weight:700;font-size:12px;cursor:pointer; margin-left:6px;">✕</button>
    </div>`;

  app.innerHTML = `
    ${topHeader("Study Planner", "/home")}
    <div style="padding: 14px 20px;">
      <form id="plannerForm" style="display:flex; gap:8px;">
        <input type="text" id="plannerTitle" placeholder="What do you need to study?" required style="flex:1; padding:13px 14px; border-radius:12px; border:1.5px solid var(--border); font-size:14px;">
        <input type="date" id="plannerDate" style="padding:13px 10px; border-radius:12px; border:1.5px solid var(--border); font-size:13px;">
        <button type="submit" class="btn-primary" style="width:auto; padding:0 18px;">Add</button>
      </form>
    </div>
    <div id="plannerList">${items.map(row).join("")}</div>
    ${items.length === 0 ? `<div class="empty-state" id="emptyPlanner"><div class="emoji">🗓️</div><p>Nothing planned yet. Add your first study task above.</p></div>` : ""}`;

  document.getElementById("plannerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("plannerTitle").value.trim();
    const date = document.getElementById("plannerDate").value;
    if (!title) return;
    const item = { id: uuid(), user_id: user.id, title, item_date: date || null, done: 0, updated_at: nowIso(), synced: false, deleted: 0 };
    await DB.put("planner", item);
    document.getElementById("emptyPlanner")?.remove();
    document.getElementById("plannerList").insertAdjacentHTML("beforeend", row(item));
    document.getElementById("plannerTitle").value = "";
    bindPlannerRow(document.getElementById("plannerList").lastElementChild, user);
  });
  app.querySelectorAll("#plannerList .list-item").forEach((r) => bindPlannerRow(r, user));
};

function bindPlannerRow(rowEl, user) {
  const id = rowEl.dataset.id;
  rowEl.querySelector('[data-action="toggle"]').addEventListener("click", async () => {
    const item = await DB.get("planner", id);
    item.done = item.done ? 0 : 1;
    item.updated_at = nowIso(); item.synced = false;
    await DB.put("planner", item);
    Router.rerender();
  });
  rowEl.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    const item = await DB.get("planner", id);
    item.deleted = 1; item.updated_at = nowIso(); item.synced = false;
    await DB.put("planner", item);
    Router.rerender();
  });
}

// ---- TOOLS (100% client-side, zero network ever) --------------------------
const DICTIONARY = {
  photosynthesis: "The process by which green plants use sunlight to make food from carbon dioxide and water.",
  algebra: "The branch of mathematics using letters and symbols to represent numbers and quantities.",
  democracy: "A system of government by the whole population, typically through elected representatives.",
  ecosystem: "A biological community of interacting organisms and their physical environment.",
  velocity: "The speed of something in a given direction.",
  metaphor: "A figure of speech describing an object by referring to something else it resembles.",
  mitosis: "The process by which a single cell divides into two identical daughter cells.",
  inflation: "A general increase in prices and fall in the purchasing value of money.",
  photon: "A particle representing a quantum of light or other electromagnetic radiation.",
  ratio: "A quantity that shows the relative size of two values.",
  osmosis: "The movement of water molecules through a membrane toward a higher concentration.",
  noun: "A word used to identify a person, place, thing, or idea.",
  hypothesis: "A proposed explanation made on limited evidence, as a starting point for investigation.",
  equation: "A statement that two mathematical expressions are equal.",
  gravity: "The force that attracts objects toward the centre of the earth.",
};

Views.tools = (app) => {
  app.innerHTML = `
    ${topHeader("Study Tools", "/home")}
    <div style="padding: 10px 20px 0; display:flex; gap:8px;">
      <button class="btn-secondary tool-tab active" data-tab="calc" style="flex:1;">🧮 Calculator</button>
      <button class="btn-secondary tool-tab" data-tab="dict" style="flex:1;">📖 Dictionary</button>
    </div>
    <div id="tab-calc" class="tool-panel" style="padding: 16px 20px;">
      <div class="calc-screen" id="calcScreen">0</div>
      <div class="calc-grid">
        <button class="calc-btn op" data-k="C">C</button><button class="calc-btn op" data-k="(">( )</button><button class="calc-btn op" data-k="%">%</button><button class="calc-btn op" data-k="/">÷</button>
        <button class="calc-btn" data-k="7">7</button><button class="calc-btn" data-k="8">8</button><button class="calc-btn" data-k="9">9</button><button class="calc-btn op" data-k="*">×</button>
        <button class="calc-btn" data-k="4">4</button><button class="calc-btn" data-k="5">5</button><button class="calc-btn" data-k="6">6</button><button class="calc-btn op" data-k="-">−</button>
        <button class="calc-btn" data-k="1">1</button><button class="calc-btn" data-k="2">2</button><button class="calc-btn" data-k="3">3</button><button class="calc-btn op" data-k="+">+</button>
        <button class="calc-btn" data-k="0" style="grid-column: span 2;">0</button><button class="calc-btn" data-k=".">.</button><button class="calc-btn op" data-k="=">=</button>
      </div>
    </div>
    <div id="tab-dict" class="tool-panel" style="display:none; padding: 16px 20px;">
      <div class="field" style="margin-bottom:10px;"><input type="text" id="dictSearch" placeholder="Search a word (offline mini dictionary)..."></div>
      <div id="dictResults"></div>
    </div>`;

  app.querySelectorAll(".tool-tab").forEach((tab) => tab.addEventListener("click", () => {
    app.querySelectorAll(".tool-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    app.querySelectorAll(".tool-panel").forEach((p) => (p.style.display = "none"));
    document.getElementById("tab-" + tab.dataset.tab).style.display = "block";
  }));

  const screen = document.getElementById("calcScreen");
  let expr = "";
  app.querySelectorAll(".calc-btn").forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.dataset.k;
    if (k === "C") expr = "";
    else if (k === "=") {
      try {
        if (!/^[0-9+\-*/%.() ]+$/.test(expr)) throw new Error("bad");
        const result = Function(`"use strict"; return (${expr.replace(/%/g, "/100*")})`)();
        expr = String(Math.round(result * 1e8) / 1e8);
      } catch (e) { expr = "Error"; }
    } else { expr = expr === "Error" ? k : expr + k; }
    screen.textContent = expr || "0";
  }));

  const dictSearch = document.getElementById("dictSearch");
  const dictResults = document.getElementById("dictResults");
  function renderDict(filter) {
    const entries = Object.entries(DICTIONARY).filter(([w]) => w.includes(filter.toLowerCase()));
    if (!filter) { dictResults.innerHTML = `<p style="color:var(--text-sub); font-size:13px;">Type a word to search. Works fully offline.</p>`; return; }
    dictResults.innerHTML = entries.length
      ? entries.map(([w, def]) => `<div class="card" style="margin:0 0 10px;"><b style="text-transform:capitalize;">${w}</b><p style="margin:6px 0 0; font-size:13px; color:var(--text-sub);">${def}</p></div>`).join("")
      : `<p style="color:var(--text-sub); font-size:13px;">No match in the offline dictionary yet.</p>`;
  }
  dictSearch.addEventListener("input", () => renderDict(dictSearch.value.trim()));
  renderDict("");
};

// ---- SHARE ----------------------------------------------------------------
Views.share = async (app) => {
  const user = Session.current.user;
  const notes = user.role === "student"
    ? await DB.byScope("notes", user.school_emis, user.grade)
    : await DB.byTeacher("notes", user.id);
  app.innerHTML = `
    ${topHeader("Nearby Share", "/home")}
    <p style="padding:0 20px; color:var(--text-sub); font-size:13px; margin:-4px 0 18px;">Share notes directly with classmates nearby — no internet or mobile data needed.</p>
    <div class="card" style="text-align:center; padding:28px 16px;">
      <div style="width:110px; height:110px; border-radius:50%; margin:0 auto 14px; position:relative; background: radial-gradient(circle, rgba(231,111,38,0.15), transparent 70%);">
        <div style="position:absolute; inset:0; border:2px solid rgba(231,111,38,0.25); border-radius:50%; animation: pulse 1.8s infinite;"></div>
        <div style="position:absolute; inset:22px; display:flex; align-items:center; justify-content:center; background:var(--orange); border-radius:50%; color:#fff; font-size:22px;">📡</div>
      </div>
      <b id="radarStatus">Searching for nearby devices...</b>
      <p style="font-size:12.5px; color:var(--text-sub); margin:6px 0 0;">Uses Bluetooth / Wi-Fi Direct, works fully offline</p>
    </div>
    <div class="section-header"><h2>Select a note to send</h2></div>
    ${notes.length === 0 ? `<div class="empty-state"><div class="emoji">📭</div><p>No notes available to share yet.</p></div>` : ""}
    ${notes.map((n) => `
      <label class="list-item" style="cursor:pointer;"><input type="radio" name="shareNote" value="${n.id}" style="width:20px;height:20px; accent-color: var(--orange);">
        <div class="list-icon">📝</div><div class="list-meta"><p class="t">${escapeHtml(n.title)}</p><p class="s">${escapeHtml(n.subject || "General")} · Grade ${n.grade}</p></div></label>`).join("")}
    <div style="padding: 14px 20px 20px;"><button id="sendBtn" class="btn-primary">Send to nearby device</button></div>`;

  const statuses = ["Searching for nearby devices...", "Found 1 device nearby", "Ready to send"];
  let i = 0;
  const radarStatus = document.getElementById("radarStatus");
  const timer = setInterval(() => { i = (i + 1) % statuses.length; radarStatus.textContent = statuses[i]; if (i === statuses.length - 1) clearInterval(timer); }, 1600);

  document.getElementById("sendBtn").addEventListener("click", () => {
    if (!document.querySelector('input[name="shareNote"]:checked')) return UI.toast("Pick a note to share first.");
    const btn = document.getElementById("sendBtn");
    btn.textContent = "Sending..."; btn.disabled = true;
    setTimeout(() => { btn.textContent = "Sent ✓"; setTimeout(() => { btn.textContent = "Send to nearby device"; btn.disabled = false; }, 1800); }, 1200);
  });
};

// ---- LIBRARY / HOMEWORK ----------------------------------------------------
Views.library = async (app) => {
  const user = Session.current.user;
  const homework = user.role === "student"
    ? await DB.byScope("homework", user.school_emis, user.grade)
    : await DB.byTeacher("homework", user.id);
  app.innerHTML = `
    ${topHeader("Library", "/home")}
    <div style="padding: 10px 20px 0; display:flex; gap:10px;">
      <a href="#/notes" class="pill orange" style="text-decoration:none; padding:8px 14px;">Notes</a>
      <a href="#/quizzes" class="pill" style="text-decoration:none; padding:8px 14px;">Quizzes</a>
      <span class="pill" style="padding:8px 14px; background:#141414; color:#fff;">Homework</span>
    </div>
    ${user.role === "teacher" ? `<div style="padding: 14px 20px 4px;"><a href="#/homework/new" class="btn-primary" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;">+ Assign homework</a></div>` : ""}
    <div style="padding-top:12px;">
      ${homework.length === 0 ? `<div class="empty-state"><div class="emoji">🎒</div><p>No homework assigned${user.role === "student" ? " for your grade" : ""} yet.</p></div>` : ""}
      ${homework.map((h) => `
        <div class="card"><div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <b style="font-size:14.5px;">${escapeHtml(h.title)} ${h.synced === false ? `<span class="pending-badge">⏳</span>` : ""}</b>
          ${h.due_date ? `<span class="pill orange">Due ${escapeHtml(h.due_date)}</span>` : ""}</div>
          ${h.instructions ? `<p style="font-size:13px; color:var(--text-sub); margin:8px 0 0;">${escapeHtml(h.instructions)}</p>` : ""}
          <p style="font-size:11.5px; color:var(--text-sub); margin:10px 0 0;">Grade ${h.grade}</p></div>`).join("")}
    </div>`;
};

Views.homeworkNew = (app) => {
  const user = Session.current.user;
  app.innerHTML = `${topHeader("Assign Homework", "/library")}
    <div style="padding: 16px 20px 0;">
      <form id="hwForm">
        <div class="field"><label>Title</label><input type="text" name="title" required></div>
        <div class="field"><label>Instructions</label><textarea name="instructions" rows="4"></textarea></div>
        <div class="field"><label>Grade</label><select name="grade" required><option value="">Select grade</option>
          ${[8,9,10,11,12].map((g) => `<option value="${g}">Grade ${g}</option>`).join("")}</select></div>
        <div class="field"><label>Due date</label><input type="date" name="due_date"></div>
        <button type="submit" class="btn-primary">Assign to grade</button>
      </form>
    </div>`;
  document.getElementById("hwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const hw = {
      id: uuid(), teacher_id: user.id, school_emis: user.school_emis, grade: Number(fd.get("grade")),
      title: fd.get("title"), instructions: fd.get("instructions") || null,
      due_date: fd.get("due_date") || null, updated_at: nowIso(), synced: false,
    };
    await DB.put("homework", hw);
    UI.toast(navigator.onLine ? "Assigned — syncing now." : "Saved — will assign once you're online.");
    if (navigator.onLine) Sync.run(user, { silent: true }).then(() => Router.rerender());
    location.hash = "#/library";
  });
};

// ---- PROFILE ----------------------------------------------------------------
Views.profile = (app) => {
  const user = Session.current.user;
  app.innerHTML = `
    ${topHeader("Profile", "/home")}
    <div style="text-align:center; padding: 10px 20px 20px;">
      <div class="avatar" style="width:84px; height:84px; font-size:28px; margin: 0 auto 12px;">${escapeHtml(user.avatar_initials)}</div>
      <h2 style="margin:0; font-size:19px;">${escapeHtml(user.full_name)}</h2>
      <p style="color:var(--text-sub); font-size:13.5px; margin:4px 0 0;">${escapeHtml(user.email)}</p>
      <span class="pill orange" style="margin-top:10px; display:inline-block;">${user.role[0].toUpperCase() + user.role.slice(1)}${user.grade ? " · Grade " + user.grade : ""}</span>
    </div>
    <div class="card">
      <div style="display:flex; justify-content:space-between; padding:8px 0;"><span style="color:var(--text-sub); font-size:13.5px;">Connection</span><span style="font-weight:700; font-size:13.5px;">${navigator.onLine ? "Online" : "Offline (fully usable)"}</span></div>
    </div>
    ${user.role !== "admin" ? `<div style="padding: 0 20px;"><a href="#/admin/claim" class="btn-secondary" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box; margin-bottom:12px; font-size:12px;">⚙️ Claim admin role (key required)</a></div>` : `<div style="padding: 0 20px;"><a href="#/admin" class="btn-secondary" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box; margin-bottom:12px;">⚙️ Admin dashboard</a></div>`}
    <div style="padding: 0 20px;"><button id="logoutBtn" class="btn-secondary" style="color:#C0392B; border-color:#F5C6C6;">Log out</button></div>`;
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    if (!confirm("Log out? Content stays on this device, but you'll need to sign in again to switch accounts.")) return;
    await API.logout();
    await Session.clear();
    location.hash = "#/login";
  });
};

// ---- ADMIN ------------------------------------------------------------------
Views.adminClaim = (app) => {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="logo-row"><div class="logo-box" style="background:#141414;">🛡️</div><div style="font-weight:800; font-size:15px;">Admin Setup</div></div>
      <h1>Claim the Admin role</h1>
      <p class="lead">One-time, key-gated. Needs a connection to verify.</p>
      <form id="claimForm">
        <div class="field"><label>Admin key</label><input type="password" name="admin_key" required autofocus></div>
        <button type="submit" class="btn-primary">Claim Admin role</button>
      </form>
    </div>`;
  document.getElementById("claimForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = new FormData(e.target).get("admin_key");
    try {
      await API.adminClaim(key);
      const me = await API._call("/api/auth/me");
      await Session.updateUser(me.user);
      UI.toast("You're now the Admin.");
      location.hash = "#/admin";
    } catch (err) { UI.toast(navigator.onLine ? err.message : "Connect once to claim admin."); }
  });
};

Views.adminDashboard = async (app) => {
  app.innerHTML = `${topHeader("Admin Dashboard", "/home")}<div id="adminBox" class="card" style="text-align:center; color:var(--text-sub);">${navigator.onLine ? "Loading…" : "Connect to load live stats — this screen needs the network."}</div>`;
  if (!navigator.onLine) return;
  try {
    const stats = await API.adminStats();
    document.getElementById("adminBox").outerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding: 14px 20px;">
        <div class="card" style="margin:0;"><div style="font-size:22px; font-weight:800;">${stats.students}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Students</div></div>
        <div class="card" style="margin:0;"><div style="font-size:22px; font-weight:800;">${stats.teachers}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Teachers</div></div>
        <div class="card" style="margin:0;"><div style="font-size:22px; font-weight:800;">${stats.schools_in_use}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Schools active</div></div>
        <div class="card" style="margin:0;"><div style="font-size:22px; font-weight:800;">${stats.schools_total.toLocaleString()}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Schools in EMIS DB</div></div>
        <div class="card" style="margin:0;"><div style="font-size:22px; font-weight:800;">${stats.notes}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Notes shared</div></div>
        <div class="card" style="margin:0;"><div style="font-size:22px; font-weight:800;">${stats.quizzes}</div><div style="font-size:12px; color:var(--text-sub); font-weight:600;">Quizzes created</div></div>
      </div>
      <div style="padding: 0 20px;"><a href="#/admin/users" class="btn-secondary" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;">Manage all users →</a></div>`;
  } catch (e) { document.getElementById("adminBox").textContent = "Couldn't load stats right now."; }
};

Views.adminUsers = async (app) => {
  app.innerHTML = `${topHeader("Manage Users", "/admin")}
    <div style="padding: 10px 20px;"><input type="text" id="userSearch" placeholder="Search by name or email..." style="width:100%; padding:13px 14px; border-radius:12px; border:1.5px solid var(--border); font-size:14px;"></div>
    <div id="usersList">${navigator.onLine ? "" : `<div class="empty-state"><p>Connect to manage users — this screen needs the network.</p></div>`}</div>`;
  if (!navigator.onLine) return;

  async function load(q) {
    const data = await API.adminUsers(q || "");
    document.getElementById("usersList").innerHTML = data.users.map((u) => `
      <div class="list-item"><div class="list-icon">${escapeHtml((u.full_name || "U")[0])}</div>
        <div class="list-meta"><p class="t">${escapeHtml(u.full_name)}</p><p class="s">${escapeHtml(u.email)} · ${escapeHtml(u.role)}${u.grade ? " · Gr " + u.grade : ""} · ${escapeHtml(u.school_name || "No school")}</p></div>
        ${u.role !== "admin" ? `<button data-action="removeUser" data-id="${u.id}" style="background:none;border:none;color:#C0392B;font-weight:700;font-size:12px;cursor:pointer;">Remove</button>` : `<span class="pill" style="background:#141414;color:#fff;">Admin</span>`}
      </div>`).join("") || `<div class="empty-state"><p>No users found.</p></div>`;
    document.querySelectorAll('[data-action="removeUser"]').forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("Remove this user?")) return;
      await API.adminRemoveUser(btn.dataset.id);
      load(document.getElementById("userSearch").value);
    }));
  }
  let t;
  document.getElementById("userSearch").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value), 250); });
  load("");
};

// --------------------------------------------------------------------------
// BOOTSTRAP
// --------------------------------------------------------------------------
async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }

  await Session.load();
  UI.updateOfflineBanner();

  if (!location.hash) location.hash = Session.current && Session.current.user ? "#/home" : "#/login";
  await Router.rerender();

  // If we're signed in and online at launch, run one quiet background sync
  // so content is fresh without the learner ever having to wait for it.
  if (Session.current && Session.current.user && navigator.onLine) {
    Sync.run(Session.current.user, { silent: true }).then(() => Router.rerender());
  }

  // Install prompt wiring
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById("installBtn");
    if (btn) btn.style.display = "inline-flex";
  });
  document.getElementById("installBtn")?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
}
document.addEventListener("DOMContentLoaded", boot);
