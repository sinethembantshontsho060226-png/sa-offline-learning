"""
SA Offline Learning App v2 — JSON API backend.

This server does almost no rendering. It exists to: (1) authenticate,
(2) hand out small JSON deltas on /api/sync/pull, (3) accept small JSON
batches on /api/sync/push, and (4) receive file uploads. The actual app
— the thing a learner installs — lives entirely in static/ as an
offline-capable PWA that stores everything in IndexedDB on the device.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000 once, while online, to install the app.
"""

import os
import json
import sqlite3
import secrets
import uuid
import time
import random
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, g, jsonify, send_from_directory, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "instance", "app.db")
SCHOOLS_JSON = os.path.join(BASE_DIR, "data", "sa_schools.json")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(os.path.join(BASE_DIR, "instance"), exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Only the holder of this key can ever claim the single Admin account.
# Change it (or set the ADMIN_SETUP_KEY env var) before you deploy.
ADMIN_SETUP_KEY = os.environ.get("ADMIN_SETUP_KEY", "sinethemba-admin-2026")

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024


# --------------------------------------------------------------------------
# DB HELPERS
# --------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout = 8000")  # wait up to 8s on a brief lock, instead of failing instantly
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    # WAL mode lets reads and a write happen at the same time instead of
    # blocking each other — the difference between "briefly queued" and
    # "database is locked" errors when many students sync at once. This
    # is a persistent, one-time setting on the database file itself.
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")  # safe pairing with WAL, much faster than FULL
    with open(os.path.join(BASE_DIR, "schema.sql"), "r") as f:
        db.executescript(f.read())
    db.execute("INSERT OR IGNORE INTO admin_lock (id, locked) VALUES (1, 0)")
    db.commit()

    # --- lightweight migration for databases that already existed before
    # this column was added (e.g. your live Render database) ---
    # CREATE TABLE IF NOT EXISTS above does nothing on a table that
    # already exists, so a brand-new column needs its own ALTER TABLE.
    # SQLite has no "ADD COLUMN IF NOT EXISTS", so we just try it and
    # ignore the error if the column is already there.
    try:
        db.execute("ALTER TABLE quiz_results ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1")
        db.commit()
        print("[init_db] Migrated: added quiz_results.attempts column.")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise
    count = db.execute("SELECT COUNT(*) FROM schools").fetchone()[0]
    if count == 0:
        if not os.path.exists(SCHOOLS_JSON):
            # Loud on purpose: this used to fail silently, leaving every
            # search returning [] forever with nothing in the logs to
            # explain why. Now it's impossible to miss in Render's log tab.
            print(f"[init_db] ERROR: schools file not found at {SCHOOLS_JSON} — "
                  f"school search will return no results until this is fixed. "
                  f"Check that data/sa_schools.json was committed to the repo "
                  f"at exactly that path (case-sensitive).")
        else:
            with open(SCHOOLS_JSON, "r", encoding="utf-8") as f:
                schools = json.load(f)
            db.executemany(
                "INSERT OR IGNORE INTO schools (emis, name, province, district, type, phase, town) "
                "VALUES (:emis, :name, :province, :district, :type, :phase, :town)",
                schools,
            )
            db.commit()
            print(f"[init_db] Loaded {len(schools)} schools from EMIS master list.")
    db.close()


def new_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")


# --------------------------------------------------------------------------
# TOKEN AUTH
# --------------------------------------------------------------------------
def current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    db = get_db()
    row = db.execute(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.token = ?",
        (token,),
    ).fetchone()
    return row


def auth_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "Not authenticated"}), 401
        g.user = user
        return view(*args, **kwargs)
    return wrapped


def retry_on_locked(max_attempts=6, base_delay=0.05):
    """
    SQLite only allows one writer at a time. Under a real burst — a
    classroom of students all logging in within the same second, say —
    WAL mode and busy_timeout reduce contention a lot but don't fully
    eliminate the rare 'database is locked' error when many writes land
    in the same instant. Rather than that surfacing as a 500 to someone
    just trying to log in, retry the whole write with a short random
    backoff — a few hundred milliseconds of invisible retrying beats a
    visible failure.
    """
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            attempt = 0
            while True:
                try:
                    return view(*args, **kwargs)
                except sqlite3.OperationalError as e:
                    if "locked" not in str(e).lower() or attempt >= max_attempts - 1:
                        raise
                    db = g.pop("db", None)
                    if db is not None:
                        try:
                            db.close()
                        except Exception:
                            pass
                    time.sleep(base_delay * (2 ** attempt) + random.uniform(0, 0.03))
                    attempt += 1
        return wrapped
    return decorator


def role_required(*roles):
    def decorator(view):
        @wraps(view)
        @auth_required
        def wrapped(*args, **kwargs):
            if g.user["role"] not in roles:
                return jsonify({"error": "Forbidden"}), 403
            return view(*args, **kwargs)
        return wrapped
    return decorator


def user_json(u):
    return {
        "id": u["id"], "full_name": u["full_name"], "email": u["email"],
        "role": u["role"], "school_emis": u["school_emis"], "grade": u["grade"],
        "avatar_initials": u["avatar_initials"],
    }


def initials_for(name):
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][0].upper()
    return (parts[0][0] + parts[-1][0]).upper()


# --------------------------------------------------------------------------
# APP SHELL
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return send_file(os.path.join(STATIC_DIR, "index.html"))


@app.route("/manifest.json")
def manifest():
    return send_from_directory(STATIC_DIR, "manifest.json")


@app.route("/service-worker.js")
def service_worker():
    resp = send_from_directory(STATIC_DIR, "service-worker.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.route("/static/data/sa_schools.json")
def schools_bundle():
    """
    Serves the pre-gzipped, full 25,493-school list as one static download.
    Devices fetch this ONCE (cached by the service worker + IndexedDB after
    that) and search it entirely client-side from then on — this is what
    keeps live per-keystroke search queries off the database/server, which
    matters a lot on a free-tier instance serving thousands of signups.
    """
    gz_path = os.path.join(STATIC_DIR, "data", "sa_schools.json.gz")
    with open(gz_path, "rb") as f:
        data = f.read()
    resp = app.response_class(data, mimetype="application/json")
    resp.headers["Content-Encoding"] = "gzip"
    resp.headers["Cache-Control"] = "public, max-age=604800"  # 7 days — this list rarely changes
    return resp


# --------------------------------------------------------------------------
# AUTH API
# --------------------------------------------------------------------------
@app.route("/api/auth/signup", methods=["POST"])
@retry_on_locked()
def api_signup():
    data = request.get_json(force=True)
    db = get_db()
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    role = data.get("role") or "student"
    school_emis = data.get("school_emis")
    grade = data.get("grade")

    if not full_name or not email or len(password) < 6:
        return jsonify({"error": "Missing or invalid fields"}), 400
    if role not in ("student", "teacher"):
        return jsonify({"error": "Invalid role"}), 400  # admin can never sign up
    if not school_emis:
        return jsonify({"error": "School is required"}), 400
    school = db.execute("SELECT * FROM schools WHERE emis = ?", (school_emis,)).fetchone()
    if not school:
        return jsonify({"error": "Unknown school"}), 400
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"error": "Email already registered"}), 409
    if role == "student" and not grade:
        return jsonify({"error": "Grade is required for students"}), 400

    uid = new_id()
    db.execute(
        "INSERT INTO users (id, full_name, email, password_hash, role, school_emis, grade, avatar_initials) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (uid, full_name, email, generate_password_hash(password), role,
         school["emis"], grade, initials_for(full_name)),
    )
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, uid))
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return jsonify({"token": token, "user": user_json(user)})


@app.route("/api/auth/login", methods=["POST"])
@retry_on_locked()
def api_login():
    data = request.get_json(force=True)
    db = get_db()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Incorrect email or password"}), 401
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user["id"]))
    db.commit()
    return jsonify({"token": token, "user": user_json(user)})


@app.route("/api/auth/logout", methods=["POST"])
@auth_required
@retry_on_locked()
def api_logout():
    db = get_db()
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if token:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/auth/me")
@auth_required
def api_me():
    return jsonify({"user": user_json(g.user)})


@app.route("/api/auth/forgot-password", methods=["POST"])
@retry_on_locked()
def api_forgot_password():
    data = request.get_json(force=True)
    db = get_db()
    email = (data.get("email") or "").strip().lower()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        # Don't reveal whether the email exists.
        return jsonify({"ok": True, "reset_token": None})
    token = secrets.token_urlsafe(24)
    expires = (datetime.utcnow() + timedelta(minutes=30)).isoformat()
    db.execute(
        "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        (user["id"], token, expires),
    )
    db.commit()
    # Simulated email: the reset token is handed straight back, exactly as
    # the original brief asked for ("password reset link sent (simulated)").
    return jsonify({"ok": True, "reset_token": token})


@app.route("/api/auth/reset-password", methods=["POST"])
@retry_on_locked()
def api_reset_password():
    data = request.get_json(force=True)
    db = get_db()
    token = data.get("token") or ""
    password = data.get("password") or ""
    row = db.execute(
        "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0", (token,)
    ).fetchone()
    if not row or datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
        return jsonify({"error": "Reset link invalid or expired"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
               (generate_password_hash(password), row["user_id"]))
    db.execute("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", (row["id"],))
    db.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# SCHOOL SEARCH (small, paginated, only used once at sign-up)
# --------------------------------------------------------------------------
@app.route("/api/schools")
def api_schools():
    q = request.args.get("q", "").strip()
    db = get_db()
    if len(q) < 2:
        return jsonify([])
    rows = db.execute(
        "SELECT emis, name, province, district, town FROM schools "
        "WHERE name LIKE ? ORDER BY name LIMIT 20",
        (f"%{q}%",),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# --------------------------------------------------------------------------
# SYNC — the whole point. Small deltas in, small deltas out.
# --------------------------------------------------------------------------
@app.route("/api/sync/pull")
@auth_required
def api_sync_pull():
    """
    Returns only records changed since `since` (ISO timestamp, or empty
    for a first full sync). A student pulls content scoped to their own
    school+grade; a teacher pulls their own authored content back (so a
    second device stays in sync); an admin pulls nothing content-wise —
    they use /api/admin/* instead, which is already paginated and tiny.
    """
    db = get_db()
    user = g.user
    since = request.args.get("since", "")
    server_time = now_iso()

    def changed(table, where, params):
        rows = db.execute(
            f"SELECT * FROM {table} WHERE {where} AND updated_at > ? ORDER BY updated_at ASC LIMIT 500",
            params + (since,),
        ).fetchall()
        return [dict(r) for r in rows]

    if user["role"] == "student":
        notes = changed("notes", "school_emis = ? AND grade = ?", (user["school_emis"], user["grade"]))
        quizzes = changed("quizzes", "school_emis = ? AND grade = ?", (user["school_emis"], user["grade"]))
        homework = changed("homework", "school_emis = ? AND grade = ?", (user["school_emis"], user["grade"]))
    elif user["role"] == "teacher":
        notes = changed("notes", "teacher_id = ?", (user["id"],))
        quizzes = changed("quizzes", "teacher_id = ?", (user["id"],))
        homework = changed("homework", "teacher_id = ?", (user["id"],))
    else:  # admin — no bulk content sync, keeps their traffic tiny
        notes, quizzes, homework = [], [], []

    for n in notes:
        n["questions_json"] = None  # not applicable, keep payload shape consistent
    for q_ in quizzes:
        q_["questions"] = json.loads(q_.pop("questions_json"))

    return jsonify({
        "server_time": server_time,
        "notes": notes,
        "quizzes": quizzes,
        "homework": homework,
    })


@app.route("/api/sync/push", methods=["POST"])
@auth_required
@retry_on_locked()
def api_sync_push():
    """
    Accepts whatever the device queued while offline: new/edited notes,
    quizzes, homework (teachers), and quiz results / planner changes
    (anyone). Everything is upserted by its client-generated uuid, so
    nothing needs ID remapping back to the device.
    """
    db = get_db()
    user = g.user
    data = request.get_json(force=True) or {}
    result = {"notes": [], "quizzes": [], "homework": [], "quiz_results": [], "planner": []}

    if user["role"] in ("teacher", "admin"):
        for n in data.get("notes", []):
            nid = n.get("id") or new_id()
            db.execute(
                "INSERT INTO notes (id, teacher_id, school_emis, grade, subject, title, note_type, content, file_path, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET title=excluded.title, subject=excluded.subject, "
                "content=excluded.content, grade=excluded.grade, note_type=excluded.note_type, "
                "updated_at=excluded.updated_at",
                (nid, user["id"], n["school_emis"], n["grade"], n.get("subject"), n["title"],
                 n.get("note_type", "text"), n.get("content"), n.get("file_path"), now_iso()),
            )
            result["notes"].append(nid)

        for qz in data.get("quizzes", []):
            qid = qz.get("id") or new_id()
            db.execute(
                "INSERT INTO quizzes (id, teacher_id, school_emis, grade, subject, title, questions_json, due_date, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET title=excluded.title, subject=excluded.subject, "
                "questions_json=excluded.questions_json, grade=excluded.grade, "
                "due_date=excluded.due_date, updated_at=excluded.updated_at",
                (qid, user["id"], qz["school_emis"], qz["grade"], qz.get("subject"), qz["title"],
                 json.dumps(qz["questions"]), qz.get("due_date"), now_iso()),
            )
            result["quizzes"].append(qid)

        for h in data.get("homework", []):
            hid = h.get("id") or new_id()
            db.execute(
                "INSERT INTO homework (id, teacher_id, school_emis, grade, title, instructions, due_date, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET title=excluded.title, instructions=excluded.instructions, "
                "grade=excluded.grade, due_date=excluded.due_date, updated_at=excluded.updated_at",
                (hid, user["id"], h["school_emis"], h["grade"], h["title"],
                 h.get("instructions"), h.get("due_date"), now_iso()),
            )
            result["homework"].append(hid)

    for r in data.get("quiz_results", []):
        rid = r.get("id") or new_id()
        attempts = int(r.get("attempts", 1))
        # WeBWorK-style: a student can retake a quiz, and the RECORDED
        # score is the best one so far, with an attempt counter that only
        # ever goes up. The device already tracks its own best-so-far
        # locally (see sync.js / app.js), so this just needs to merge
        # that into the server's copy without ever losing a higher score
        # or a higher attempt count from a previous sync (e.g. if the
        # same student's two devices sync in an unexpected order).
        db.execute(
            "INSERT INTO quiz_results (id, quiz_id, student_id, score, total, answers_json, attempts, submitted_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(quiz_id, student_id) DO UPDATE SET "
            "  score = MAX(quiz_results.score, excluded.score), "
            "  total = excluded.total, "
            "  answers_json = excluded.answers_json, "  # always the most recent attempt, for feedback — score stays the best
            "  attempts = MAX(quiz_results.attempts, excluded.attempts), "
            "  submitted_at = excluded.submitted_at",
            (rid, r["quiz_id"], user["id"], r["score"], r["total"], json.dumps(r.get("answers", [])), attempts, now_iso()),
        )
        result["quiz_results"].append(rid)

    for p in data.get("planner", []):
        pid = p.get("id") or new_id()
        db.execute(
            "INSERT INTO planner_items (id, user_id, title, item_date, done, updated_at, deleted) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, item_date=excluded.item_date, "
            "done=excluded.done, updated_at=excluded.updated_at, deleted=excluded.deleted",
            (pid, user["id"], p["title"], p.get("item_date"), int(p.get("done", 0)),
             now_iso(), int(p.get("deleted", 0))),
        )
        result["planner"].append(pid)

    db.commit()
    return jsonify({"ok": True, "server_time": now_iso(), "ids": result})


@app.route("/api/notes/<note_id>/upload", methods=["POST"])
@role_required("teacher", "admin")
@retry_on_locked()
def api_note_upload(note_id):
    db = get_db()
    note = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not note or (note["teacher_id"] != g.user["id"] and g.user["role"] != "admin"):
        return jsonify({"error": "Not found"}), 404
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "No file"}), 400
    filename = secure_filename(f"{secrets.token_hex(6)}_{f.filename}")
    f.save(os.path.join(UPLOAD_DIR, filename))
    note_type = "pdf" if filename.lower().endswith(".pdf") else "voice"
    db.execute("UPDATE notes SET file_path = ?, note_type = ?, updated_at = ? WHERE id = ?",
               (filename, note_type, now_iso(), note_id))
    db.commit()
    return jsonify({"file_path": filename, "url": f"/static/uploads/{filename}"})


# --------------------------------------------------------------------------
# ADMIN — single locked admin account, tiny paginated JSON only
# --------------------------------------------------------------------------
@app.route("/api/admin/claim", methods=["POST"])
@auth_required
@retry_on_locked()
def api_admin_claim():
    db = get_db()
    lock = db.execute("SELECT * FROM admin_lock WHERE id = 1").fetchone()
    if lock and lock["locked"]:
        return jsonify({"error": "Admin already claimed on this install"}), 403
    data = request.get_json(force=True)
    if data.get("admin_key") != ADMIN_SETUP_KEY:
        return jsonify({"error": "Incorrect admin key"}), 403
    db.execute("UPDATE users SET role = 'admin' WHERE id = ?", (g.user["id"],))
    db.execute("UPDATE admin_lock SET locked = 1, admin_user_id = ? WHERE id = 1", (g.user["id"],))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/stats")
@role_required("admin")
def api_admin_stats():
    db = get_db()
    return jsonify({
        "students": db.execute("SELECT COUNT(*) c FROM users WHERE role='student'").fetchone()["c"],
        "teachers": db.execute("SELECT COUNT(*) c FROM users WHERE role='teacher'").fetchone()["c"],
        "schools_in_use": db.execute("SELECT COUNT(DISTINCT school_emis) c FROM users").fetchone()["c"],
        "schools_total": db.execute("SELECT COUNT(*) c FROM schools").fetchone()["c"],
        "notes": db.execute("SELECT COUNT(*) c FROM notes WHERE deleted=0").fetchone()["c"],
        "quizzes": db.execute("SELECT COUNT(*) c FROM quizzes WHERE deleted=0").fetchone()["c"],
    })


@app.route("/api/admin/users")
@role_required("admin")
def api_admin_users():
    db = get_db()
    q = request.args.get("q", "").strip()
    cursor = request.args.get("cursor", "")
    params = []
    where = ""
    if q:
        where = "WHERE (users.full_name LIKE ? OR users.email LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    if cursor:
        where += (" AND" if where else "WHERE") + " users.created_at < ?"
        params.append(cursor)
    rows = db.execute(
        f"SELECT users.id, users.full_name, users.email, users.role, users.grade, "
        f"users.created_at, schools.name AS school_name FROM users "
        f"LEFT JOIN schools ON schools.emis = users.school_emis {where} "
        f"ORDER BY users.created_at DESC LIMIT 25",
        params,
    ).fetchall()
    next_cursor = rows[-1]["created_at"] if len(rows) == 25 else None
    return jsonify({"users": [dict(r) for r in rows], "next_cursor": next_cursor})


@app.route("/api/admin/users/<user_id>/remove", methods=["POST"])
@role_required("admin")
@retry_on_locked()
def api_admin_user_remove(user_id):
    db = get_db()
    target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not target or target["role"] == "admin":
        return jsonify({"error": "Cannot remove this user"}), 400
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/quizzes/<quiz_id>/results")
@role_required("teacher", "admin")
def api_quiz_results(quiz_id):
    db = get_db()
    quiz = db.execute("SELECT * FROM quizzes WHERE id = ?", (quiz_id,)).fetchone()
    if not quiz or (g.user["role"] == "teacher" and quiz["teacher_id"] != g.user["id"]):
        return jsonify({"error": "Not found"}), 404
    rows = db.execute(
        "SELECT quiz_results.*, users.full_name FROM quiz_results "
        "JOIN users ON users.id = quiz_results.student_id "
        "WHERE quiz_id = ? ORDER BY score DESC",
        (quiz_id,),
    ).fetchall()
    return jsonify({"quiz": dict(quiz), "results": [dict(r) for r in rows]})



# Runs the moment this module is imported — by `python app.py` locally,
# AND by gunicorn/any WSGI server in production (e.g. `gunicorn app:app`
# on Render). Safe to run on every boot: schema uses CREATE TABLE IF NOT
# EXISTS and the school import uses INSERT OR IGNORE, so this never
# duplicates data or wipes anything that's already there.
init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)
