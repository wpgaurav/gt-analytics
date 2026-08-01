import { describe, expect, test } from "vitest";
import { clearSessionCookie, createSessionCookie, readCookie, SESSION_COOKIE_NAME } from "../session";

describe("session cookies", () => {
    test("creates an opaque HttpOnly cookie with secure production defaults", () => {
        expect(createSessionCookie("gts_secret", new Request("https://stats.example.com"))).toBe(
            `${SESSION_COOKIE_NAME}=gts_secret; HttpOnly; Max-Age=2592000; Path=/; SameSite=Lax; Secure`,
        );
    });

    test("allows local HTTP development without Secure", () => {
        expect(createSessionCookie("gts_secret", new Request("http://localhost"))).not.toContain("Secure");
    });

    test("clears the account session cookie", () => {
        expect(clearSessionCookie(new Request("https://stats.example.com"))).toContain(
            `${SESSION_COOKIE_NAME}=; HttpOnly; Max-Age=0`,
        );
    });

    test("reads only the requested cookie", () => {
        const request = new Request("https://stats.example.com", {
            headers: { Cookie: `other=one; ${SESSION_COOKIE_NAME}=gts_value%2Bencoded` },
        });
        expect(readCookie(request, SESSION_COOKIE_NAME)).toBe("gts_value+encoded");
    });
});
