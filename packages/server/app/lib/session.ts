import { randomSecret, sha256 } from "./crypto";

export const SESSION_MAX_AGE_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_COOKIE_NAME = "__gt_analytics_session";

export function readCookie(request: Request, name: string): string | null {
    const header = request.headers.get("Cookie");
    if (!header) return null;
    for (const item of header.split(";")) {
        const [key, ...rest] = item.trim().split("=");
        if (key === name) return decodeURIComponent(rest.join("="));
    }
    return null;
}

export async function createSession(
    db: D1Database,
    userId: string,
    accountId: string,
): Promise<string> {
    const token = `gts_${randomSecret()}`;
    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare(
        `INSERT INTO sessions (token_hash, user_id, account_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
    ).bind(await sha256(token), userId, accountId, now + SESSION_MAX_AGE_IN_SECONDS, now).run();
    if (!result.success) {
        console.error("session creation failed", result);
        throw new Error("Session could not be created");
    }
    return token;
}

export async function deleteSession(db: D1Database, request: Request): Promise<void> {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    if (!token) return;
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export function createSessionCookie(token: string, request?: Request): string {
    const secure = !request || new URL(request.url).protocol === "https:" ? "; Secure" : "";

    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Max-Age=${SESSION_MAX_AGE_IN_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function clearSessionCookie(request?: Request): string {
    const secure = !request || new URL(request.url).protocol === "https:" ? "; Secure" : "";

    return `${SESSION_COOKIE_NAME}=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}
