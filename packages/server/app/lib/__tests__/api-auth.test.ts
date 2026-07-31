import { describe, expect, test } from "vitest";
import jwt from "jsonwebtoken";

import { constantTimeEqual, requireApiAuth } from "../api-auth";

const JWT_SECRET = "test-secret";
const API_TOKEN = "gt_analytics_test_token_value";

function envWithAuth(overrides: Partial<Env> = {}) {
    return {
        CF_PASSWORD_HASH: "$2b$12$test.hash.value",
        CF_JWT_SECRET: JWT_SECRET,
        CF_API_TOKEN: API_TOKEN,
        ...overrides,
    } as unknown as Env;
}

function requestWith(headers: Record<string, string> = {}) {
    return new Request("https://stats.example.com/resources/paths", { headers });
}

function validCookie() {
    const token = jwt.sign({ authenticated: true }, JWT_SECRET, {
        issuer: "counterscale",
    });
    return { Cookie: `__counterscale_token=${token}` };
}

async function statusOfThrown(promise: Promise<unknown>) {
    try {
        await promise;
        return null;
    } catch (thrown) {
        if (thrown instanceof Response) return thrown.status;
        throw thrown;
    }
}

describe("requireApiAuth", () => {
    test("rejects a request with no credentials", async () => {
        expect(
            await statusOfThrown(requireApiAuth(requestWith(), envWithAuth())),
        ).toBe(401);
    });

    test("accepts a valid session cookie", async () => {
        const result = await requireApiAuth(
            requestWith(validCookie()),
            envWithAuth(),
        );
        expect(result).toMatchObject({ authenticated: true, via: "cookie" });
    });

    test("accepts a correct bearer token", async () => {
        const result = await requireApiAuth(
            requestWith({ Authorization: `Bearer ${API_TOKEN}` }),
            envWithAuth(),
        );
        expect(result).toMatchObject({ authenticated: true, via: "bearer" });
    });

    test("rejects an incorrect bearer token", async () => {
        expect(
            await statusOfThrown(
                requireApiAuth(
                    requestWith({ Authorization: "Bearer wrong-token" }),
                    envWithAuth(),
                ),
            ),
        ).toBe(401);
    });

    test("rejects bearer auth when no API token is configured", async () => {
        expect(
            await statusOfThrown(
                requireApiAuth(
                    requestWith({ Authorization: `Bearer ${API_TOKEN}` }),
                    envWithAuth({ CF_API_TOKEN: "" } as Partial<Env>),
                ),
            ),
        ).toBe(401);
    });

    test("a bad bearer token does not fall through to a valid cookie", async () => {
        // Otherwise a token probe could be answered using an unrelated session
        // that happened to ride along on the same request.
        expect(
            await statusOfThrown(
                requireApiAuth(
                    requestWith({
                        ...validCookie(),
                        Authorization: "Bearer wrong-token",
                    }),
                    envWithAuth(),
                ),
            ),
        ).toBe(401);
    });

    test("allows everything when auth is disabled deployment-wide", async () => {
        const result = await requireApiAuth(
            requestWith(),
            { CF_AUTH_ENABLED: "false" } as unknown as Env,
        );
        expect(result).toMatchObject({ authenticated: true, via: "disabled" });
    });

    test("throws 401 as a Response, not a redirect", async () => {
        // A redirect answers an XHR with 200 + a login page, which a JSON
        // caller cannot tell apart from real data.
        try {
            await requireApiAuth(requestWith(), envWithAuth());
            throw new Error("expected requireApiAuth to throw");
        } catch (thrown) {
            expect(thrown).toBeInstanceOf(Response);
            const response = thrown as Response;
            expect(response.status).toBe(401);
            expect(response.headers.get("WWW-Authenticate")).toContain(
                "Bearer",
            );
            await expect(response.json()).resolves.toEqual({
                error: "unauthorized",
            });
        }
    });
});

describe("constantTimeEqual", () => {
    test("matches identical strings", () => {
        expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    });

    test("rejects differing strings of equal length", () => {
        expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    });

    test("rejects strings of differing length", () => {
        expect(constantTimeEqual("abc", "abcd")).toBe(false);
    });

    test("handles empty strings", () => {
        expect(constantTimeEqual("", "")).toBe(true);
        expect(constantTimeEqual("", "a")).toBe(false);
    });

    test("handles multi-byte characters", () => {
        expect(constantTimeEqual("tökén", "tökén")).toBe(true);
        expect(constantTimeEqual("tökén", "tokén")).toBe(false);
    });
});
