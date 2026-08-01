import { randomId, randomSecret, sha256 } from "~/lib/crypto";

export const API_SCOPES = ["analytics:read", "realtime:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiKeyRow {
    id: string;
    account_id: string;
    site_id: string | null;
    site_label: string | null;
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
        `SELECT k.id, k.account_id, k.site_id, s.label AS site_label,
                k.name, k.prefix, k.scopes, k.last_used_at, k.expires_at,
                k.revoked_at, k.created_at
           FROM api_keys k
           LEFT JOIN sites s
             ON s.site_id = k.site_id AND s.account_id = k.account_id
          WHERE k.account_id = ?
          ORDER BY k.created_at DESC`,
    ).bind(accountId).all<ApiKeyRow>();
    return results ?? [];
}

export async function createApiKey(
    db: D1Database,
    accountId: string,
    siteId: string,
    name: string,
    scopes: ApiScope[] = [...API_SCOPES],
): Promise<{ id: string; token: string } | null> {
    const id = randomId("key", 12);
    const prefix = randomSecret(6);
    const token = `gta_${prefix}_${randomSecret(32)}`;
    const result = await db.prepare(
        `INSERT INTO api_keys (id, account_id, site_id, name, prefix, token_hash, scopes)
         SELECT ?, ?, site_id, ?, ?, ?, ?
           FROM sites
          WHERE account_id = ? AND site_id = ?`,
    ).bind(
        id,
        accountId,
        name.trim().slice(0, 80) || "API key",
        prefix,
        await sha256(token),
        JSON.stringify(scopes),
        accountId,
        siteId,
    ).run();
    return (result.meta?.changes ?? 0) > 0 ? { id, token } : null;
}

export async function scopeApiKeyToSite(
    db: D1Database,
    accountId: string,
    id: string,
    siteId: string,
): Promise<boolean> {
    const result = await db.prepare(
        `UPDATE api_keys
            SET site_id = ?
          WHERE id = ? AND account_id = ? AND site_id IS NULL
            AND EXISTS (
                SELECT 1 FROM sites
                 WHERE sites.site_id = ? AND sites.account_id = ?
            )`,
    ).bind(siteId, id, accountId, siteId, accountId).run();
    return (result.meta?.changes ?? 0) > 0;
}

export async function revokeApiKey(db: D1Database, accountId: string, id: string): Promise<void> {
    await db.prepare(
        `UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND account_id = ?`,
    ).bind(id, accountId).run();
}

export async function deleteApiKey(db: D1Database, accountId: string, id: string): Promise<boolean> {
    const result = await db.prepare(
        "DELETE FROM api_keys WHERE id = ? AND account_id = ?",
    ).bind(id, accountId).run();
    return (result.meta?.changes ?? 0) > 0;
}

export async function authenticateApiKey(
    db: D1Database,
    token: string,
): Promise<{ accountId: string; siteId: string; scopes: ApiScope[]; keyId: string } | null> {
    // randomSecret(6) and randomSecret(32) always produce 8- and 43-character
    // base64url values. Keep those boundaries explicit because `_` is valid
    // inside either value and a greedy separator would reject valid keys.
    const match = /^gta_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) return null;
    const row = await db.prepare(
        `SELECT k.id, k.account_id, k.site_id, k.token_hash, k.scopes, k.expires_at
           FROM api_keys k
           JOIN sites s
             ON s.site_id = k.site_id AND s.account_id = k.account_id
          WHERE k.prefix = ? AND k.revoked_at IS NULL AND k.site_id IS NOT NULL`,
    ).bind(match[1]).first<{
        id: string;
        account_id: string;
        site_id: string;
        token_hash: string;
        scopes: string;
        expires_at: number | null;
    }>();
    if (!row || !fixedTimeEqual(row.token_hash, await sha256(token))) return null;
    if (row.expires_at && row.expires_at <= Math.floor(Date.now() / 1000)) return null;

    await db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))")
        .bind(row.id).run();
    const scopes = JSON.parse(row.scopes) as ApiScope[];
    return { accountId: row.account_id, siteId: row.site_id, scopes, keyId: row.id };
}

function fixedTimeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
}
