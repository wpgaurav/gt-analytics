import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import bcrypt from "bcryptjs";
import { getUser, isAuthEnabled, login, logout, requireAuth } from "../auth";
import { SESSION_COOKIE_NAME } from "../session";

vi.mock("bcryptjs");

function dbWith(user: Record<string, unknown> | null = null) {
    return {
        prepare: vi.fn((sql: string) => ({
            bind: vi.fn((..._args: unknown[]) => ({
                first: vi.fn(async () => sql.includes("FROM users u") || sql.includes("FROM sessions s") ? user : { count: user ? 1 : 0 }),
                run: vi.fn(async () => ({ success: true })),
            })),
        })),
    } as unknown as D1Database;
}

const row = {
    id: "usr_one",
    account_id: "acct_one",
    username: "gaurav",
    display_name: "Gaurav",
    password_hash: "hash",
    role: "owner",
    is_system_admin: 0,
    disabled: 0,
    account_name: "Main",
};

describe("account authentication", () => {
    beforeEach(() => vi.mocked(bcrypt.compare).mockResolvedValue(true as never));
    afterEach(() => vi.clearAllMocks());

    test("honours explicit auth configuration and legacy bootstrap detection", () => {
        expect(isAuthEnabled({ CF_AUTH_ENABLED: "false" } as Env)).toBe(false);
        expect(isAuthEnabled({ CF_AUTH_ENABLED: "true" } as Env)).toBe(true);
        expect(isAuthEnabled({ CF_PASSWORD_HASH: "hash" } as Env)).toBe(true);
        expect(isAuthEnabled({} as Env)).toBe(false);
    });

    test("logs a database user in and sets an opaque session cookie", async () => {
        const db = dbWith(row);
        const response = await login(
            new Request("https://stats.example.com"),
            "gaurav",
            "correct horse battery staple",
            { CF_AUTH_ENABLED: "true", SITES_DB: db } as Env,
        ) as Response;
        expect(bcrypt.compare).toHaveBeenCalledWith("correct horse battery staple", "hash");
        expect(response.status).toBe(302);
        expect(response.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE_NAME}=gts_`);
    });

    test("rejects an invalid password", async () => {
        vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
        await expect(login(new Request("https://stats.example.com"), "gaurav", "wrong", {
            CF_AUTH_ENABLED: "true", SITES_DB: dbWith(row),
        } as Env)).rejects.toThrow("Invalid credentials");
    });

    test("resolves an opaque session to its account principal", async () => {
        const user = await getUser(new Request("https://stats.example.com", {
            headers: { Cookie: `${SESSION_COOKIE_NAME}=gts_secret` },
        }), { CF_AUTH_ENABLED: "true", SITES_DB: dbWith(row) } as Env);
        expect(user).toMatchObject({ authenticated: true, userId: "usr_one", accountId: "acct_one", accountName: "Main" });
    });

    test("redirects unauthenticated browser requests", async () => {
        await expect(requireAuth(new Request("https://stats.example.com"), {
            CF_AUTH_ENABLED: "true", SITES_DB: dbWith(null),
        } as Env)).rejects.toMatchObject({ status: 302 });
    });

    test("auth-disabled deployments map to the default account", async () => {
        await expect(requireAuth(new Request("https://stats.example.com"), {
            CF_AUTH_ENABLED: "false",
        } as Env)).resolves.toMatchObject({ authenticated: true, accountId: "acct_default" });
    });

    test("logout revokes the stored session and clears the cookie", async () => {
        const db = dbWith(row);
        const response = await logout(new Request("https://stats.example.com", {
            headers: { Cookie: `${SESSION_COOKIE_NAME}=gts_secret` },
        }), { SITES_DB: db } as Env) as Response;
        expect(response.status).toBe(302);
        expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    });
});
