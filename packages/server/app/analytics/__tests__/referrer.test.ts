import { describe, expect, test } from "vitest";

import {
    classifyChannel,
    detectClickId,
    isInternalReferrer,
    referrerHost,
} from "../referrer";

describe("referrerHost", () => {
    test("extracts and lowercases the hostname", () => {
        expect(referrerHost("https://Example.COM/some/page")).toBe(
            "example.com",
        );
    });

    test("strips www so a source does not split into two rows", () => {
        expect(referrerHost("https://www.google.com/")).toBe(
            referrerHost("https://google.com/"),
        );
    });

    test("returns empty for absent or unparseable referrers", () => {
        expect(referrerHost("")).toBe("");
        expect(referrerHost(null)).toBe("");
        expect(referrerHost(undefined)).toBe("");
        expect(referrerHost("::::")).toBe("");
    });

    test("drops self referrals, including subdomains", () => {
        expect(referrerHost("https://example.com/a", "example.com")).toBe("");
        expect(referrerHost("https://www.example.com/a", "example.com")).toBe(
            "",
        );
        expect(referrerHost("https://blog.example.com/a", "example.com")).toBe(
            "",
        );
    });

    test("keeps hosts that merely contain the site name", () => {
        // The upstream check was a substring test, so every one of these was
        // silently discarded as internal traffic.
        expect(referrerHost("https://notexample.com/a", "example.com")).toBe(
            "notexample.com",
        );
        expect(
            referrerHost("https://example.com.evil.net/a", "example.com"),
        ).toBe("example.com.evil.net");
        expect(referrerHost("https://myexample.com/a", "example.com")).toBe(
            "myexample.com",
        );
    });

    test("understands android-app referrers", () => {
        expect(referrerHost("android-app://com.google.android.gm")).toBe(
            "com.google.android.gm",
        );
    });
});

describe("isInternalReferrer", () => {
    test("recognises same-site navigation", () => {
        expect(isInternalReferrer("https://example.com/a", "example.com")).toBe(
            true,
        );
    });

    test("an absent referrer is not internal, it is direct", () => {
        expect(isInternalReferrer("", "example.com")).toBe(false);
    });

    test("an external referrer is not internal", () => {
        expect(isInternalReferrer("https://google.com/", "example.com")).toBe(
            false,
        );
    });
});

describe("detectClickId", () => {
    test("finds a click id and the platform it implies", () => {
        expect(detectClickId(new URLSearchParams("?gclid=abc"))).toEqual({
            name: "gclid",
            source: "google",
        });
        expect(detectClickId(new URLSearchParams("?fbclid=xyz"))).toEqual({
            name: "fbclid",
            source: "facebook",
        });
        expect(detectClickId(new URLSearchParams("?msclkid=1"))).toEqual({
            name: "msclkid",
            source: "bing",
        });
    });

    test("returns null when there is none", () => {
        expect(detectClickId(new URLSearchParams("?utm_source=x"))).toBeNull();
        expect(detectClickId(null)).toBeNull();
    });
});

describe("classifyChannel", () => {
    test("no referrer at all is direct", () => {
        expect(classifyChannel({ referrer: "" })).toBe("direct");
    });

    test("a same-site referrer is internal, not direct", () => {
        // Folding internal navigation into direct traffic would overstate how
        // many people arrive with no source.
        expect(
            classifyChannel({
                referrer: "https://example.com/a",
                selfHost: "example.com",
            }),
        ).toBe("internal");
    });

    test("classifies search engines", () => {
        for (const host of [
            "https://www.google.com/",
            "https://google.co.in/",
            "https://duckduckgo.com/",
            "https://www.bing.com/",
            "https://search.brave.com/",
        ]) {
            expect(classifyChannel({ referrer: host })).toBe("search");
        }
    });

    test("classifies AI assistants separately from search", () => {
        for (const host of [
            "https://chatgpt.com/",
            "https://www.perplexity.ai/",
            "https://claude.ai/",
            "https://gemini.google.com/",
            "https://copilot.microsoft.com/",
        ]) {
            expect(classifyChannel({ referrer: host })).toBe("ai");
        }
    });

    test("gemini.google.com is AI, not search, despite the google.* suffix", () => {
        // Ordering matters: the AI list has to be consulted before the search
        // list or every assistant on a search engine's domain is miscounted.
        expect(classifyChannel({ referrer: "https://gemini.google.com/app" }))
            .toBe("ai");
    });

    test("classifies social sources", () => {
        for (const host of [
            "https://www.facebook.com/",
            "https://t.co/abc",
            "https://www.linkedin.com/feed",
            "https://news.ycombinator.com/item?id=1",
            "https://bsky.app/profile/x",
        ]) {
            expect(classifyChannel({ referrer: host })).toBe("social");
        }
    });

    test("classifies webmail as email", () => {
        expect(classifyChannel({ referrer: "https://mail.google.com/" })).toBe(
            "email",
        );
    });

    test("a click id means paid, whatever the referrer says", () => {
        expect(
            classifyChannel({
                referrer: "https://www.google.com/",
                clickId: "gclid",
            }),
        ).toBe("paid");
        // Even with no referrer at all, which is the common case for ads.
        expect(classifyChannel({ referrer: "", clickId: "fbclid" })).toBe(
            "paid",
        );
    });

    test("an explicit utm_medium outranks inference", () => {
        expect(
            classifyChannel({
                referrer: "https://www.google.com/",
                utmMedium: "cpc",
            }),
        ).toBe("paid");
        expect(
            classifyChannel({
                referrer: "https://example.net/",
                utmMedium: "newsletter",
            }),
        ).toBe("email");
        expect(
            classifyChannel({
                referrer: "",
                utmMedium: "organic",
            }),
        ).toBe("search");
    });

    test("an unrecognised external site is a plain referral", () => {
        expect(classifyChannel({ referrer: "https://someblog.dev/post" })).toBe(
            "referral",
        );
    });

    test("falls back to utm_source when the referrer is unhelpful", () => {
        expect(
            classifyChannel({
                referrer: "https://l.example.net/",
                utmSource: "chatgpt.com",
            }),
        ).toBe("ai");
    });
});
