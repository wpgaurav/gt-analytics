import { describe, expect, test } from "vitest";

import { absoluteUrl, displayUrl, sourceName } from "../sources";

describe("absoluteUrl", () => {
    test("adds a scheme to a bare host", () => {
        // The bug this exists for: a schemeless href resolves against the
        // dashboard's own origin, so "chatgpt.com" linked to
        // https://stats.gauravtiwari.org/chatgpt.com.
        expect(absoluteUrl("chatgpt.com")).toBe("https://chatgpt.com/");
        expect(absoluteUrl("www.bing.com/search")).toBe(
            "https://www.bing.com/search",
        );
    });

    test("leaves an already absolute URL alone", () => {
        expect(absoluteUrl("https://chatgpt.com/c/abc")).toBe(
            "https://chatgpt.com/c/abc",
        );
        expect(absoluteUrl("http://example.com/")).toBe("http://example.com/");
    });

    test("returns null for values that are not linkable", () => {
        expect(absoluteUrl("")).toBeNull();
        expect(absoluteUrl(null)).toBeNull();
        expect(absoluteUrl(undefined)).toBeNull();
        // App referrers are real sources with nowhere to link.
        expect(absoluteUrl("android-app://com.google.android.gm")).toBeNull();
    });

    test("returns null for a slug recorded as a referrer", () => {
        // Real recorded junk: a relative path arrived as the referrer.
        // Inventing https://cloud-storage-black-friday-deals/ would be a
        // link to nowhere.
        expect(absoluteUrl("cloud-storage-black-friday-deals")).toBeNull();
        expect(absoluteUrl("self")).toBeNull();
    });
});

describe("sourceName", () => {
    test("names known sources", () => {
        expect(sourceName("chatgpt.com")).toBe("ChatGPT");
        expect(sourceName("chat.openai.com")).toBe("ChatGPT");
        expect(sourceName("t.co")).toBe("X (Twitter)");
        expect(sourceName("mail.google.com")).toBe("Gmail");
    });

    test("collapses country variants of a search engine", () => {
        // google.co.in and google.com.au should not each get a row.
        expect(sourceName("google.co.in")).toBe("Google");
        expect(sourceName("google.com.au")).toBe("Google");
        expect(sourceName("cn.bing.com")).toBe("Bing");
    });

    test("resolves a subdomain of a known source", () => {
        expect(sourceName("de.linkedin.com")).toBe("LinkedIn");
    });

    test("falls back to the hostname", () => {
        expect(sourceName("someblog.dev")).toBe("someblog.dev");
    });

    test("no host is direct traffic", () => {
        expect(sourceName("")).toBe("Direct");
    });
});

describe("displayUrl", () => {
    test("drops the scheme and a trailing slash", () => {
        expect(displayUrl("https://chatgpt.com/")).toBe("chatgpt.com");
        expect(displayUrl("https://www.bing.com/search")).toBe(
            "www.bing.com/search",
        );
    });

    test("leaves a bare value readable", () => {
        expect(displayUrl("chatgpt.com")).toBe("chatgpt.com");
        expect(displayUrl("")).toBe("");
    });
});
