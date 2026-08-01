import { randomId, randomSecret, sha256 } from "~/lib/crypto";

export const API_SCOPES = ["analytics:read", "realtime:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiKeyRow {
    id: string;
    account_id: string;
    name: string;
    prefix: string;
    scopes: string;
    last_used_at: string | null;
    expires_at: number | null;
    revoked_at: string | null;
    created_at: string;
}

export async function listApiKeys(db: D1Database, accountId: string): Promise<ApiKeyRow[]> {
    const { results } = await db.prepare(
        `SELECT id, account_id, name, prefix, scopes, last_used_at, expires_at,
                revoked_at, created_at
           FROM api_keys WHERE account_id = ? ORDER BY created_at DESC`,
    ).bind(accountId).all<ApiKeyRow>();
    return results ?? [];
}

export async function createApiKey(
    db: D1Database,
    accountId: string,
    name: string,
    scopes: ApiScope[] = [...API_SCOPES],
): Promise<{ id: string; token: string }> {
    const id = randomId("key", 12);
    const prefix = randomSecret(6);
    const token = `gta_${prefix}_${randomSecret(32)}`;
    await db.prepare(
        `INSERT INTO api_keys (id, account_id, name, prefix, token_hash, scopes)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
        id,
        accountId,
        name.trim().slice(0, 80) || "API key",
        prefix,
        await sha256(token),
        JSON.stringify(scopes),
    ).run();
    return { id, token };
}

export async function revokeApiKey(db: D1Database, accountId: string, id: string): Promise<void> {
    await db.prepare(
        `UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND account_id = ?`,
    ).bind(id, accountId).run();
}

export async function authenticateApiKey(
    db: D1Database,
    token: string,
): Promise<{ accountId: string; scopes: ApiScope[]; keyId: string } | null> {
    // randomSecret(6) and randomSecret(32) always produce 8- and 43-character
    // base64url values. Keep those boundaries explicit because `_` is valid
    // inside either value and a greedy separator would reject valid keys.
    const match = /^gta_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) return null;
    const row = await db.prepare(
        `SELECT id, account_id, token_hash, scopes, expires_at
           FROM api_keys
          WHERE prefix = ? AND revoked_at IS NULL`,
    ).bind(match[1]).first<{
        id: string;
        account_id: string;
        token_hash: string;
        scopes: string;
        expires_at: number | null;
    }>();
    if (!row || !fixedTimeEqual(row.token_hash, await sha256(token))) return null;
    if (row.expires_at && row.expires_at <= Math.floor(Date.now() / 1000)) return null;

    await db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))")
        .bind(row.id).run();
    const scopes = JSON.parse(row.scopes) as ApiScope[];
    return { accountId: row.account_id, scopes, keyId: row.id };
}

function fixedTimeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
}
