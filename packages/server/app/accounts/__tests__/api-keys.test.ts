import { describe, expect, test, vi } from "vitest";
import {
    authenticateApiKey,
    createApiKey,
    deleteApiKey,
    scopeApiKeyToSite,
} from "../api-keys";
import { sha256 } from "~/lib/crypto";

describe("authenticateApiKey", () => {
    test("accepts underscores inside a generated API key secret", async () => {
        const token = `gta_abc_def-_${"a".repeat(10)}_${"b".repeat(32)}`;
        const first = vi.fn(async () => ({
            id: "key_one",
            account_id: "acct_one",
            site_id: "example.com",
            token_hash: await sha256(token),
            scopes: JSON.stringify(["analytics:read", "realtime:read"]),
            expires_at: null,
        }));
        const run = vi.fn(async () => ({ success: true }));
        const bind = vi.fn(() => ({ first, run }));
        const db = { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database;

        await expect(authenticateApiKey(db, token)).resolves.toMatchObject({
            accountId: "acct_one",
            siteId: "example.com",
            keyId: "key_one",
            scopes: ["analytics:read", "realtime:read"],
        });
        expect(bind).toHaveBeenNthCalledWith(1, "abc_def-");
    });
});

describe("createApiKey", () => {
    test("creates a key only through an account-owned site", async () => {
        const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
        const bind = vi.fn(() => ({ run }));
        const prepare = vi.fn(() => ({ bind }));
        const db = { prepare } as unknown as D1Database;

        const created = await createApiKey(db, "acct_one", "example.com", "WordPress");

        expect(created?.token).toMatch(/^gta_/);
        expect(prepare).toHaveBeenCalledWith(expect.stringContaining("FROM sites"));
        expect(bind.mock.calls[0]).toEqual(expect.arrayContaining(["acct_one", "example.com", "WordPress"]));
    });

    test("does not return a token when the site is outside the account", async () => {
        const run = vi.fn(async () => ({ success: true, meta: { changes: 0 } }));
        const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })) } as unknown as D1Database;

        await expect(createApiKey(db, "acct_one", "private.example", "Blocked")).resolves.toBeNull();
    });
});

describe("scopeApiKeyToSite", () => {
    test("assigns only an unscoped key and an account-owned site", async () => {
        const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
        const bind = vi.fn(() => ({ run }));
        const prepare = vi.fn(() => ({ bind }));
        const db = { prepare } as unknown as D1Database;

        await expect(scopeApiKeyToSite(db, "acct_one", "key_one", "example.com")).resolves.toBe(true);
        expect(prepare).toHaveBeenCalledWith(expect.stringContaining("site_id IS NULL"));
        expect(bind).toHaveBeenCalledWith("example.com", "key_one", "acct_one", "example.com", "acct_one");
    });
});

describe("deleteApiKey", () => {
    test("permanently deletes only the key belonging to the current account", async () => {
        const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
        const bind = vi.fn(() => ({ run }));
        const prepare = vi.fn(() => ({ bind }));
        const db = { prepare } as unknown as D1Database;

        await expect(deleteApiKey(db, "acct_one", "key_one")).resolves.toBe(true);

        expect(prepare).toHaveBeenCalledWith(
            "DELETE FROM api_keys WHERE id = ? AND account_id = ?",
        );
        expect(bind).toHaveBeenCalledWith("key_one", "acct_one");
        expect(run).toHaveBeenCalledOnce();
    });

    test("reports when no account-scoped key was deleted", async () => {
        const run = vi.fn(async () => ({ success: true, meta: { changes: 0 } }));
        const bind = vi.fn(() => ({ run }));
        const db = { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database;

        await expect(deleteApiKey(db, "acct_one", "key_other")).resolves.toBe(false);
    });
});
