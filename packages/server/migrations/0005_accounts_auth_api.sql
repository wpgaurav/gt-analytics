-- Account isolation, password/passkey authentication, and scoped API access.
-- Existing rows are assigned to the default account so this is a safe upgrade
-- for single-account installations.

CREATE TABLE IF NOT EXISTS accounts (
    id         TEXT PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL,
    timezone   TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO accounts (id, slug, name)
VALUES ('acct_default', 'default', 'GT Analytics');

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT,
    role            TEXT NOT NULL DEFAULT 'owner',
    is_system_admin INTEGER NOT NULL DEFAULT 0,
    disabled        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_account ON users (account_id);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    public_key    TEXT NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    transports    TEXT,
    device_type   TEXT,
    backed_up     INTEGER NOT NULL DEFAULT 0,
    name          TEXT NOT NULL DEFAULT 'Passkey',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at  TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (user_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    kind       TEXT NOT NULL,
    challenge  TEXT NOT NULL,
    rp_id      TEXT NOT NULL,
    origin     TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    window_at   INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_window ON login_attempts (window_at);

CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL UNIQUE,
    token_hash   TEXT NOT NULL,
    scopes       TEXT NOT NULL,
    last_used_at TEXT,
    expires_at   INTEGER,
    revoked_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys (account_id);

CREATE TABLE IF NOT EXISTS account_settings (
    account_id TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, key),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

ALTER TABLE sites ADD COLUMN account_id TEXT NOT NULL DEFAULT 'acct_default';
CREATE INDEX IF NOT EXISTS idx_sites_account ON sites (account_id, label);

ALTER TABLE presets ADD COLUMN account_id TEXT NOT NULL DEFAULT 'acct_default';
CREATE INDEX IF NOT EXISTS idx_presets_account ON presets (account_id, position, id);
