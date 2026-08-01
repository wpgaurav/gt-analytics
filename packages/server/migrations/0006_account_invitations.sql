-- New accounts may only be created through expiring, single-use invitations.
-- Raw invitation tokens are never persisted; only SHA-256 hashes are stored.

CREATE TABLE IF NOT EXISTS account_invitations (
    id                 TEXT PRIMARY KEY,
    token_hash         TEXT NOT NULL UNIQUE,
    account_name       TEXT NOT NULL,
    account_slug       TEXT NOT NULL COLLATE NOCASE,
    account_timezone   TEXT NOT NULL DEFAULT 'UTC',
    created_by_user_id TEXT,
    expires_at         INTEGER NOT NULL,
    accepted_at        INTEGER,
    revoked_at         INTEGER,
    created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_invitations_expiry
    ON account_invitations (expires_at);

CREATE INDEX IF NOT EXISTS idx_account_invitations_slug
    ON account_invitations (account_slug, accepted_at, revoked_at);
