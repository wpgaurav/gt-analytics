import { describe, expect, test, vi } from "vitest";
import { constantTimeEqual, requireApiAuth } from "../api-auth";
import { sha256 } from "../crypto";
import { SESSION_COOKIE_NAME } from "../session";

const API_TOKEN = "gt_analytics_test_token_value";
const SITE_TOKEN = `gta_abcdefgh_${"a".repeat(43)}`;

function sessionDb(ownsSite = true) {
    return {
        prepare: vi.fn((sql: string) => ({ bind: vi.fn(() => ({
            first: vi.fn(async () => {
                if (sql.includes("FROM sessions s")) return {
                    id: "usr_one", account_id: "acct_one", username: "gaurav", display_name: "Gaurav",
                    role: "owner", is_system_admin: 0, disabled: 0, account_name: "Main",
                };
                if (sql.includes("FROM sites")) return ownsSite ? { owned: 1 } : null;
                return null;
            }),
            run: vi.fn(async () => ({ success: true })),
        })) })),
    } as unknown as D1Database;
}

function siteKeyDb() {
    return {
        prepare: vi.fn((sql: string) => ({ bind: vi.fn(() => ({
            first: vi.fn(async () => sql.includes("FROM api_keys") ? {
                id: "key_one",
                account_id: "acct_one",
                site_id: "example.com",
                token_hash: await sha256(SITE_TOKEN),
                scopes: JSON.stringify(["analytics:read", "realtime:read"]),
                expires_at: null,
            } : null),
            run: vi.fn(async () => ({ success: true })),
        })) })),
    } as unknown as D1Database;
}

function env(overrides: Partial<Env> = {}) {
    return { CF_AUTH_ENABLED: "true", CF_API_TOKEN: API_TOKEN, SITES_DB: sessionDb(), ...overrides } as Env;
}

async function statusOfThrown(promise: Promise<unknown>) {
    try { await promise; return null; } catch (error) { if (error instanceof Response) return error.status; throw error; }
}

describe("requireApiAuth", () => {
    test("rejects a request with no credentials", async () => {
        expect(await statusOfThrown(requireApiAuth(new Request("https://stats.example.com/api/v1/sites"), env()))).toBe(401);
    });

    test("accepts an account session cookie", async () => {
        const result = await requireApiAuth(new Request("https://stats.example.com/api/v1/sites", {
            headers: { Cookie: `${SESSION_COOKIE_NAME}=gts_secret` },
        }), env());
        expect(result).toMatchObject({ authenticated: true, via: "cookie", accountId: "acct_one" });
    });

    test("maps the legacy deployment token only to the default account", async () => {
        const result = await requireApiAuth(new Request("https://stats.example.com/api/v1/sites", {
            headers: { Authorization: `Bearer ${API_TOKEN}` },
        }), env());
        expect(result).toMatchObject({ via: "legacy-bearer", accountId: "acct_default" });
    });

    test("returns the site bound to a generated API key", async () => {
        const result = await requireApiAuth(new Request("https://stats.example.com/api/v1/analytics", {
            headers: { Authorization: `Bearer ${SITE_TOKEN}` },
        }), env({ SITES_DB: siteKeyDb() }));
        expect(result).toMatchObject({ via: "api-key", accountId: "acct_one", siteId: "example.com" });
    });

    test("does not let a site-scoped key request another site", async () => {
        const request = new Request("https://stats.example.com/api/v1/analytics?site=private.example", {
            headers: { Authorization: `Bearer ${SITE_TOKEN}` },
        });
        expect(await statusOfThrown(requireApiAuth(request, env({ SITES_DB: siteKeyDb() })))).toBe(404);
    });

    test("does not let an invalid bearer token fall through to a valid cookie", async () => {
        expect(await statusOfThrown(requireApiAuth(new Request("https://stats.example.com/api/v1/sites", {
            headers: { Authorization: "Bearer wrong", Cookie: `${SESSION_COOKIE_NAME}=gts_secret` },
        }), env({ SITES_DB: undefined as unknown as D1Database })))).toBe(401);
    });

    test("returns a JSON 401 with a bearer challenge", async () => {
        try {
            await requireApiAuth(new Request("https://stats.example.com/api/v1/sites"), env());
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(Response);
            expect((error as Response).headers.get("WWW-Authenticate")).toContain("Bearer");
        }
    });

    test("returns 404 when a valid account session requests another account's site", async () => {
        const request = new Request("https://stats.example.com/api/v1/analytics?site=private-site", {
            headers: { Cookie: `${SESSION_COOKIE_NAME}=gts_secret` },
        });
        expect(await statusOfThrown(requireApiAuth(request, env({ SITES_DB: sessionDb(false) })))).toBe(404);
    });

    test("auth-disabled deployments use the default account", async () => {
        await expect(requireApiAuth(new Request("https://stats.example.com/api/v1/sites"), {
            CF_AUTH_ENABLED: "false",
        } as Env)).resolves.toMatchObject({ via: "disabled", accountId: "acct_default" });
    });
});

describe("constantTimeEqual", () => {
    test("matches identical values and rejects mismatches", () => {
        expect(constantTimeEqual("tökén", "tökén")).toBe(true);
        expect(constantTimeEqual("abc123", "abc124")).toBe(false);
        expect(constantTimeEqual("abc", "abcd")).toBe(false);
    });
});
