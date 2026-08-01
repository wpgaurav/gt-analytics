import { redirect } from "react-router";
import bcrypt from "bcryptjs";
import { DEFAULT_ACCOUNT_ID } from "~/accounts/accounts";
import { randomId, sha256 } from "./crypto";
import {
    clearSessionCookie,
    createSession,
    createSessionCookie,
    deleteSession,
    readCookie,
    SESSION_COOKIE_NAME,
} from "./session";
import { User } from "./types";

interface UserRow {
    id: string;
    account_id: string;
    username: string;
    display_name: string;
    password_hash: string | null;
    role: string;
    is_system_admin: number;
    disabled: number;
    account_name: string;
}

export function isAuthEnabled(env: Env): boolean {
    if (env.CF_AUTH_ENABLED === "false") return false;
    if (env.CF_AUTH_ENABLED === "true") return true;
    return Boolean(env.CF_PASSWORD_HASH);
}

export async function login(
    request: Request,
    usernameOrPassword: string,
    passwordOrEnv: string | Env,
    maybeEnv?: Env,
) {
    const env = maybeEnv ?? passwordOrEnv as Env;
    const username = maybeEnv ? usernameOrPassword : "owner";
    const password = maybeEnv ? passwordOrEnv as string : usernameOrPassword;
    if (!isAuthEnabled(env)) return redirect("/dashboard");
    if (!env.SITES_DB) throw new Error("Account database is unavailable");

    const normalized = username.trim().toLowerCase();
    const attemptKey = await loginAttemptKey(request, normalized);
    await assertLoginAllowed(env.SITES_DB, attemptKey);
    let user = await findUserByUsername(env.SITES_DB, normalized);
    if (!user) user = await bootstrapLegacyOwner(env, normalized, password);

    if (!user || user.disabled || !user.password_hash) {
        await recordLoginFailure(env.SITES_DB, attemptKey);
        throw new Error("Invalid credentials");
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
        await recordLoginFailure(env.SITES_DB, attemptKey);
        throw new Error("Invalid credentials");
    }

    await env.SITES_DB.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(attemptKey).run();
    const token = await createSession(env.SITES_DB, user.id, user.account_id);
    return redirect("/dashboard", {
        headers: { "Set-Cookie": createSessionCookie(token, request) },
    });
}

async function bootstrapLegacyOwner(
    env: Env,
    username: string,
    password: string,
): Promise<UserRow | null> {
    if (username !== "owner" || !env.CF_PASSWORD_HASH) return null;
    const count = await env.SITES_DB.prepare("SELECT COUNT(*) AS count FROM users")
        .first<{ count: number }>();
    if ((count?.count ?? 0) !== 0) return null;
    if (!(await bcrypt.compare(password, env.CF_PASSWORD_HASH))) return null;

    const userId = randomId("usr", 12);
    await env.SITES_DB.prepare(
        `INSERT INTO users
            (id, account_id, username, display_name, password_hash, role, is_system_admin)
         VALUES (?, ?, 'owner', 'Owner', ?, 'owner', 1)`,
    ).bind(userId, DEFAULT_ACCOUNT_ID, env.CF_PASSWORD_HASH).run();
    return findUserByUsername(env.SITES_DB, "owner");
}

export async function logout(request: Request, env: Env) {
    if (env.SITES_DB) {
        try {
            await deleteSession(env.SITES_DB, request);
        } catch (error) {
            console.error("could not delete session", error);
        }
    }
    return redirect("/", {
        headers: { "Set-Cookie": clearSessionCookie(request) },
    });
}

export async function requireAuth(request: Request, env: Env): Promise<User> {
    if (!isAuthEnabled(env)) return disabledUser();
    const user = await getUser(request, env);
    if (!user.authenticated) throw redirect("/");
    return user;
}

export async function getUser(request: Request, env: Env): Promise<User> {
    if (!isAuthEnabled(env)) return disabledUser();
    if (!env.SITES_DB) return { authenticated: false };

    try {
        const token = readCookie(request, SESSION_COOKIE_NAME);
        if (!token) return { authenticated: false };
        const now = Math.floor(Date.now() / 1000);
        const row = await env.SITES_DB.prepare(
            `SELECT u.id, u.account_id, u.username, u.display_name, u.role,
                    u.is_system_admin, u.disabled, a.name AS account_name
               FROM sessions s
               JOIN users u ON u.id = s.user_id
               JOIN accounts a ON a.id = s.account_id
              WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
        ).bind(await sha256(token), now).first<Omit<UserRow, "password_hash">>();
        return row ? rowToUser(row) : { authenticated: false };
    } catch {
        return { authenticated: false };
    }
}

export async function findUserByUsername(
    db: D1Database,
    username: string,
): Promise<UserRow | null> {
    return db.prepare(
        `SELECT u.*, a.name AS account_name
           FROM users u JOIN accounts a ON a.id = u.account_id
          WHERE u.username = ? COLLATE NOCASE`,
    ).bind(username).first<UserRow>();
}

export async function getUserById(db: D1Database, userId: string): Promise<UserRow | null> {
    return db.prepare(
        `SELECT u.*, a.name AS account_name
           FROM users u JOIN accounts a ON a.id = u.account_id
          WHERE u.id = ?`,
    ).bind(userId).first<UserRow>();
}

function rowToUser(row: Omit<UserRow, "password_hash">): User {
    return {
        authenticated: true,
        userId: row.id,
        accountId: row.account_id,
        username: row.username,
        displayName: row.display_name,
        accountName: row.account_name,
        role: row.role,
        isSystemAdmin: row.is_system_admin === 1,
    };
}

function disabledUser(): User {
    return {
        authenticated: true,
        accountId: DEFAULT_ACCOUNT_ID,
        accountName: "GT Analytics",
        role: "owner",
        isSystemAdmin: true,
    };
}

const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 10;

async function loginAttemptKey(request: Request, username: string): Promise<string> {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    return sha256(`${ip}:${username}`);
}

async function assertLoginAllowed(db: D1Database, key: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare("DELETE FROM login_attempts WHERE window_at <= ?")
        .bind(now - LOGIN_WINDOW_SECONDS).run();
    const row = await db.prepare("SELECT attempts, window_at FROM login_attempts WHERE attempt_key = ?")
        .bind(key).first<{ attempts: number; window_at: number }>();
    if (row && row.attempts >= MAX_LOGIN_ATTEMPTS && row.window_at > now - LOGIN_WINDOW_SECONDS) {
        throw new Error("Too many sign-in attempts");
    }
}

async function recordLoginFailure(db: D1Database, key: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
        `INSERT INTO login_attempts (attempt_key, window_at, attempts) VALUES (?, ?, 1)
         ON CONFLICT(attempt_key) DO UPDATE SET
            attempts = CASE WHEN login_attempts.window_at <= ? THEN 1 ELSE login_attempts.attempts + 1 END,
            window_at = CASE WHEN login_attempts.window_at <= ? THEN excluded.window_at ELSE login_attempts.window_at END`,
    ).bind(key, now, now - LOGIN_WINDOW_SECONDS, now - LOGIN_WINDOW_SECONDS).run();
}
