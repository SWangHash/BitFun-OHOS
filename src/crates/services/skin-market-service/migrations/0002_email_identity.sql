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
ALTER TABLE users ADD COLUMN account_id TEXT;
UPDATE users SET account_id = CAST(github_id AS TEXT) WHERE github_id IS NOT NULL;
CREATE UNIQUE INDEX users_account_id ON users(account_id);
