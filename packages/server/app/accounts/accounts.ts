import bcrypt from "bcryptjs";
import { randomId } from "~/lib/crypto";

export const DEFAULT_ACCOUNT_ID = "acct_default";

export interface Account {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    created_at: string;
    updated_at: string;
}

export interface AccountUser {
    id: string;
    account_id: string;
    username: string;
    display_name: string;
    role: string;
    is_system_admin: number;
    disabled: number;
}

export async function getAccount(db: D1Database, accountId: string): Promise<Account | null> {
    return db.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId).first<Account>();
}

export async function updateAccount(
    db: D1Database,
    accountId: string,
    input: { name: string; timezone: string },
): Promise<void> {
    await db.prepare(
        `UPDATE accounts SET name = ?, timezone = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(input.name.trim().slice(0, 100), input.timezone, accountId).run();
}

export async function listAccounts(db: D1Database): Promise<Account[]> {
    const { results } = await db.prepare(
        "SELECT * FROM accounts ORDER BY name COLLATE NOCASE",
    ).all<Account>();
    return results ?? [];
}

export async function createAccountWithOwner(
    db: D1Database,
    input: { name: string; slug: string; timezone: string; username: string; password: string },
): Promise<{ accountId: string; userId: string }> {
    const accountId = randomId("acct", 12);
    const userId = randomId("usr", 12);
    const passwordHash = await bcrypt.hash(input.password, 12);
    await db.batch([
        db.prepare(
            `INSERT INTO accounts (id, slug, name, timezone) VALUES (?, ?, ?, ?)`,
        ).bind(accountId, input.slug, input.name, input.timezone),
        db.prepare(
            `INSERT INTO users (id, account_id, username, display_name, password_hash, role)
             VALUES (?, ?, ?, ?, ?, 'owner')`,
        ).bind(userId, accountId, input.username, input.username, passwordHash),
    ]);
    return { accountId, userId };
}

export function validAccountSlug(value: string): boolean {
    return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(value);
}
