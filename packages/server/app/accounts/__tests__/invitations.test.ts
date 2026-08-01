import { describe, expect, test, vi } from "vitest";
import {
    acceptAccountInvitation,
    createAccountInvitation,
    validUsername,
} from "../invitations";

interface FakeStatement {
    query: string;
    args: unknown[];
    bind: (...args: unknown[]) => FakeStatement;
    first: <T>() => Promise<T | null>;
    run: () => Promise<object>;
    all: <T>() => Promise<{ results: T[] }>;
}

function statement(
    query: string,
    firstValue: unknown = null,
): FakeStatement {
    const value: FakeStatement = {
        query,
        args: [],
        bind(...args: unknown[]) {
            value.args = args;
            return value;
        },
        first: async <T>() => firstValue as T | null,
        run: async () => ({}),
        all: async <T>() => ({ results: [] as T[] }),
    };
    return value;
}

describe("account invitations", () => {
    test("stores only a hash and expires a new invitation after seven days", async () => {
        const statements: FakeStatement[] = [];
        const db = {
            prepare: vi.fn((query: string) => {
                const prepared = statement(query);
                statements.push(prepared);
                return prepared;
            }),
        } as unknown as D1Database;
        const before = Math.floor(Date.now() / 1000);

        const created = await createAccountInvitation(db, {
            accountName: "Example Analytics",
            accountSlug: "example",
            accountTimezone: "Asia/Kolkata",
            createdByUserId: "usr_admin",
        });

        const insert = statements.find((item) => item.query.includes("INSERT INTO account_invitations"));
        expect(insert).toBeDefined();
        expect(insert?.args[1]).not.toBe(created.token);
        expect(String(insert?.args[1])).not.toContain(created.token);
        expect(created.invitation.expires_at).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60);
        expect(created.invitation.expires_at).toBeLessThanOrEqual(before + 7 * 24 * 60 * 60 + 1);
    });

    test("accepts a valid invite by atomically creating its account and owner", async () => {
        const statements: FakeStatement[] = [];
        const batch = vi.fn(async (_statements: D1PreparedStatement[]) => []);
        const invitation = {
            id: "inv_test",
            token_hash: "hash",
            account_name: "Example Analytics",
            account_slug: "example",
            account_timezone: "UTC",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            accepted_at: null,
            revoked_at: null,
            created_at: Math.floor(Date.now() / 1000),
        };
        const db = {
            prepare: vi.fn((query: string) => {
                const prepared = statement(
                    query,
                    query.includes("SELECT * FROM account_invitations")
                        ? invitation
                        : query.includes("SELECT u.id")
                            ? { id: "usr_test" }
                            : null,
                );
                statements.push(prepared);
                return prepared;
            }),
            batch,
        } as unknown as D1Database;

        await acceptAccountInvitation(db, {
            token: "raw-invitation-token",
            username: "new.owner",
            displayName: "New Owner",
            password: "a-strong-password",
        });

        expect(batch).toHaveBeenCalledOnce();
        const batched = batch.mock.calls[0][0] as unknown as FakeStatement[];
        expect(batched).toHaveLength(3);
        expect(batched[0].query).toContain("UPDATE account_invitations");
        expect(batched[1].query).toContain("INSERT INTO accounts");
        expect(batched[2].query).toContain("INSERT INTO users");
        expect(batched[2].args).toContain("new.owner");
        expect(batched[2].args).toContain("New Owner");
        expect(batched[2].args).not.toContain("a-strong-password");
    });

    test("rejects an invalid or consumed invitation", async () => {
        const db = {
            prepare: vi.fn((query: string) => statement(query)),
            batch: vi.fn(),
        } as unknown as D1Database;

        await expect(acceptAccountInvitation(db, {
            token: "not-valid",
            username: "new.owner",
            displayName: "New Owner",
            password: "a-strong-password",
        })).rejects.toThrow(/invalid, expired, or already used/i);
        expect(db.batch).not.toHaveBeenCalled();
    });

    test("keeps usernames within the deployment-wide login format", () => {
        expect(validUsername("account.owner")).toBe(true);
        expect(validUsername("UPPERCASE")).toBe(false);
        expect(validUsername("ab")).toBe(false);
        expect(validUsername("spaces are out")).toBe(false);
    });
});
