-- Preserve all internal IDs and foreign-key references. The runner disables
-- foreign keys on its exclusive migration connection, then checks them before commit.
CREATE TABLE users_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id INTEGER UNIQUE,
    login TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
INSERT INTO users_next SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_next RENAME TO users;
CREATE TABLE email_identities (
    email TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    verified_at INTEGER NOT NULL
);
CREATE TABLE login_flows (
    ticket_hash TEXT PRIMARY KEY,
    transaction_id TEXT REFERENCES desktop_auth_transactions(id),
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
);
CREATE INDEX login_flows_expiry ON login_flows(expires_at);
CREATE TABLE email_challenges (
    id TEXT PRIMARY KEY,
    ticket_hash TEXT NOT NULL REFERENCES login_flows(ticket_hash) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
);
CREATE INDEX email_challenges_address_time ON email_challenges(email, created_at);
CREATE INDEX email_challenges_time ON email_challenges(created_at);
CREATE TABLE email_browser_grants (
    grant_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
