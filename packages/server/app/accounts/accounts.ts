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

export function validAccountSlug(value: string): boolean {
    return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(value);
}
