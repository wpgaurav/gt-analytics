import { describe, expect, test, vi } from "vitest";
import { authenticateApiKey, deleteApiKey } from "../api-keys";
import { sha256 } from "~/lib/crypto";

describe("authenticateApiKey", () => {
    test("accepts underscores inside a generated API key secret", async () => {
        const token = `gta_abc_def-_${"a".repeat(10)}_${"b".repeat(32)}`;
        const first = vi.fn(async () => ({
            id: "key_one",
            account_id: "acct_one",
            token_hash: await sha256(token),
            scopes: JSON.stringify(["analytics:read", "realtime:read"]),
            expires_at: null,
        }));
        const run = vi.fn(async () => ({ success: true }));
        const bind = vi.fn(() => ({ first, run }));
        const db = { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database;

        await expect(authenticateApiKey(db, token)).resolves.toMatchObject({
            accountId: "acct_one",
            keyId: "key_one",
            scopes: ["analytics:read", "realtime:read"],
        });
        expect(bind).toHaveBeenNthCalledWith(1, "abc_def-");
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
