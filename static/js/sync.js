/*
 * sync.js — delta sync. One call pulls only what changed since last time
 * (a few KB), one call pushes only queued local changes (a few KB). This
 * is what "less data for teachers and admin" means concretely: nobody
 * ever re-downloads a full page or a full note list, only the diff.
 */
const Sync = {
  _running: false,

  async pull(user) {
    const since = (await DB.kvGet("last_sync")) || "";
    const data = await API.syncPull(since);

    if (data.notes && data.notes.length) {
      const existing = await DB.all("notes");
      const existingById = Object.fromEntries(existing.map((n) => [n.id, n]));
      const merged = data.notes.map((n) => ({ ...n, synced: true }));
      await DB.putAll("notes", merged);
    }
    if (data.quizzes && data.quizzes.length) {
      const merged = data.quizzes.map((q) => ({ ...q, synced: true }));
      await DB.putAll("quizzes", merged);
    }
    if (data.homework && data.homework.length) {
      const merged = data.homework.map((h) => ({ ...h, synced: true }));
      await DB.putAll("homework", merged);
    }
    await DB.kvSet("last_sync", data.server_time);
    return data;
  },

  async push(user) {
    const [notesU, quizzesU, homeworkU, resultsU, plannerU] = await Promise.all([
      user.role !== "student" ? DB.unsynced("notes") : [],
      user.role !== "student" ? DB.unsynced("quizzes") : [],
      user.role !== "student" ? DB.unsynced("homework") : [],
      DB.unsynced("quiz_results"),
      DB.unsynced("planner"),
    ]);

    if (!notesU.length && !quizzesU.length && !homeworkU.length && !resultsU.length && !plannerU.length) {
      return { pushed: 0 };
    }

    const payload = {
      notes: notesU.map(({ synced, ...n }) => n),
      quizzes: quizzesU.map(({ synced, ...q }) => q),
      homework: homeworkU.map(({ synced, ...h }) => h),
      quiz_results: resultsU.map(({ synced, ...r }) => r),
      planner: plannerU.map(({ synced, ...p }) => p),
    };
    await API.syncPush(payload);

    // mark everything we just pushed as synced
    for (const n of notesU) await DB.put("notes", { ...n, synced: true });
    for (const q of quizzesU) await DB.put("quizzes", { ...q, synced: true });
    for (const h of homeworkU) await DB.put("homework", { ...h, synced: true });
    for (const r of resultsU) await DB.put("quiz_results", { ...r, synced: true });
    for (const p of plannerU) await DB.put("planner", { ...p, synced: true });

    // flush any pending file uploads queued while offline
    const pending = await DB.all("pending_uploads");
    for (const p of pending) {
      try {
        const res = await API.uploadFile(p.note_id, p.blob, p.filename);
        const note = await DB.get("notes", p.note_id);
        if (note) await DB.put("notes", { ...note, file_path: res.file_path, note_type: res.file_path.endsWith(".pdf") ? "pdf" : "voice", synced: true });
        await DB.delete("pending_uploads", p.id);
      } catch (e) { /* try again on next sync */ }
    }

    return {
      pushed: notesU.length + quizzesU.length + homeworkU.length + resultsU.length + plannerU.length,
    };
  },

  async run(user, { silent = false } = {}) {
    if (this._running) return;
    if (!navigator.onLine) {
      if (!silent) UI.toast("You're offline — will sync automatically when you're back online.");
      return;
    }
    this._running = true;
    if (!silent) UI.showSyncPill("Syncing…");
    try {
      await this.push(user);
      await this.pull(user);
      if (!silent) UI.showSyncPill("Up to date", 1200);
    } catch (e) {
      if (!silent) UI.showSyncPill("Sync failed — will retry", 1800);
    } finally {
      this._running = false;
    }
  },

  async pendingCount() {
    const [n, q, h, r, p] = await Promise.all([
      DB.unsynced("notes"), DB.unsynced("quizzes"), DB.unsynced("homework"),
      DB.unsynced("quiz_results"), DB.unsynced("planner"),
    ]);
    return n.length + q.length + h.length + r.length + p.length;
  },
};

// Auto-sync whenever the device comes back online.
window.addEventListener("online", async () => {
  const session = await DB.kvGet("session");
  if (session && session.user) Sync.run(session.user, { silent: true }).then(() => Router.rerender());
});
