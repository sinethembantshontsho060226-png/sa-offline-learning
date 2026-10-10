-- SA Offline Learning App v2 — API-first schema.
-- Every content table uses a TEXT (uuid) primary key, generated on the
-- DEVICE, so the installed app can create records offline and sync them
-- later without the server ever needing to remap an ID.
-- `updated_at` on every content table drives delta sync: the app only
-- ever asks for "what changed since my last sync" — a few KB of JSON,
-- not a page reload.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schools (
    emis            INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    province        TEXT,
    district        TEXT,
    type            TEXT,
    phase           TEXT,
    town            TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    school_emis     INTEGER,
    grade           INTEGER,
    avatar_initials TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (school_emis) REFERENCES schools (emis)
);

CREATE TABLE IF NOT EXISTS sessions (
    token           TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS admin_lock (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    admin_user_id   TEXT,
    locked          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (admin_user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    token           TEXT NOT NULL UNIQUE,
    expires_at      TEXT NOT NULL,
    used            INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS notes (
    id              TEXT PRIMARY KEY,
    teacher_id      TEXT NOT NULL,
    school_emis     INTEGER NOT NULL,
    grade           INTEGER NOT NULL,
    subject         TEXT,
    title           TEXT NOT NULL,
    note_type       TEXT NOT NULL DEFAULT 'text',
    content         TEXT,
    file_path       TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    deleted         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (teacher_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS quizzes (
    id              TEXT PRIMARY KEY,
    teacher_id      TEXT NOT NULL,
    school_emis     INTEGER NOT NULL,
    grade           INTEGER NOT NULL,
    subject         TEXT,
    title           TEXT NOT NULL,
    questions_json  TEXT NOT NULL,
    due_date        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    deleted         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (teacher_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS homework (
    id              TEXT PRIMARY KEY,
    teacher_id      TEXT NOT NULL,
    school_emis     INTEGER NOT NULL,
    grade           INTEGER NOT NULL,
    title           TEXT NOT NULL,
    instructions    TEXT,
    due_date        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    deleted         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (teacher_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS quiz_results (
    id              TEXT PRIMARY KEY,
    quiz_id         TEXT NOT NULL,
    student_id      TEXT NOT NULL,
    score           INTEGER NOT NULL,
    total           INTEGER NOT NULL,
    answers_json    TEXT,
    submitted_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (quiz_id) REFERENCES quizzes (id),
    FOREIGN KEY (student_id) REFERENCES users (id),
    UNIQUE (quiz_id, student_id)
);

CREATE TABLE IF NOT EXISTS planner_items (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    title           TEXT NOT NULL,
    item_date       TEXT,
    done            INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now')),
    deleted         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_notes_scope ON notes (school_emis, grade, updated_at);
CREATE INDEX IF NOT EXISTS idx_quizzes_scope ON quizzes (school_emis, grade, updated_at);
CREATE INDEX IF NOT EXISTS idx_homework_scope ON homework (school_emis, grade, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_teacher ON notes (teacher_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_quizzes_teacher ON quizzes (teacher_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_homework_teacher ON homework (teacher_id, updated_at);
