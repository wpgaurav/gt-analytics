import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { RealtimeSite } from "../../../workers/realtime";
import { pushRealtimeHit, visitorKey } from "../realtime-client";

function makeSite() {
    return new RealtimeSite(
        {} as unknown as DurableObjectState,
        {},
    );
}

async function hit(site: RealtimeSite, body: Record<string, unknown>) {
    return site.fetch(
        new Request("https://realtime/hit", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    );
}

async function snapshot(site: RealtimeSite) {
    const response = await site.fetch(
        new Request("https://realtime/snapshot"),
    );
    return await response.json();
}

describe("RealtimeSite", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-31T12:00:30Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("counts distinct visitors, not hits", async () => {
        const site = makeSite();
        await hit(site, { siteId: "s", visitor: "a", path: "/one/" });
        await hit(site, { siteId: "s", visitor: "a", path: "/two/" });
        await hit(site, { siteId: "s", visitor: "b", path: "/one/" });

        const snap = (await snapshot(site)) as Record<string, number>;
        expect(snap.activeVisitors).toBe(2);
        expect(snap.viewsInWindow).toBe(3);
    });

    test("drops visitors who fall outside the active window", async () => {
        const site = makeSite();
        await hit(site, { siteId: "s", visitor: "old", path: "/x/" });

        // Six minutes later: past the five-minute active window.
        vi.setSystemTime(new Date("2026-07-31T12:06:30Z"));
        await hit(site, { siteId: "s", visitor: "new", path: "/y/" });

        const snap = (await snapshot(site)) as Record<string, number>;
        expect(snap.activeVisitors).toBe(1);
    });

    test("prunes buckets beyond the 30-minute window", async () => {
        const site = makeSite();
        await hit(site, { siteId: "s", visitor: "a", path: "/old/" });

        vi.setSystemTime(new Date("2026-07-31T12:45:00Z"));
        await hit(site, { siteId: "s", visitor: "b", path: "/new/" });

        const snap = (await snapshot(site)) as {
            viewsInWindow: number;
            topPaths: [string, number][];
        };
        expect(snap.viewsInWindow).toBe(1);
        expect(snap.topPaths.map(([p]) => p)).toEqual(["/new/"]);
    });

    test("emits one bucket per minute including empty ones", async () => {
        const site = makeSite();
        await hit(site, { siteId: "s", visitor: "a", path: "/x/" });

        const snap = (await snapshot(site)) as {
            perMinute: { views: number }[];
        };
        // A gap has to stay visible in the sparkline rather than being
        // compressed away.
        expect(snap.perMinute).toHaveLength(30);
        expect(snap.perMinute[29].views).toBe(1);
        expect(snap.perMinute[0].views).toBe(0);
    });

    test("counts conversions separately from views", async () => {
        const site = makeSite();
        await hit(site, { siteId: "s", visitor: "a", path: "/p/" });
        await hit(site, {
            siteId: "s",
            visitor: "a",
            kind: "conversion",
            name: "signup",
        });

        const snap = (await snapshot(site)) as Record<string, number>;
        expect(snap.viewsInWindow).toBe(1);
        expect(snap.conversionsInWindow).toBe(1);
    });

    test("keeps the newest entries first in the feed", async () => {
        const site = makeSite();
        await hit(site, { siteId: "s", visitor: "a", path: "/first/" });
        await hit(site, { siteId: "s", visitor: "a", path: "/second/" });

        const snap = (await snapshot(site)) as {
            feed: { path: string }[];
        };
        expect(snap.feed[0].path).toBe("/second/");
    });

    test("caps the feed so memory cannot grow without bound", async () => {
        const site = makeSite();
        for (let i = 0; i < 120; i++) {
            await hit(site, { siteId: "s", visitor: "a", path: `/p${i}/` });
        }

        const snap = (await snapshot(site)) as { feed: unknown[] };
        expect(snap.feed).toHaveLength(50);
    });

    test("aggregates channels, referrers and countries", async () => {
        const site = makeSite();
        await hit(site, {
            siteId: "s",
            visitor: "a",
            path: "/x/",
            channel: "ai",
            referrerHost: "chatgpt.com",
            country: "IN",
        });
        await hit(site, {
            siteId: "s",
            visitor: "b",
            path: "/x/",
            channel: "ai",
            referrerHost: "chatgpt.com",
            country: "US",
        });

        const snap = (await snapshot(site)) as {
            topChannels: [string, number][];
            topReferrers: [string, number][];
            topCountries: [string, number][];
        };
        expect(snap.topChannels).toEqual([["ai", 2]]);
        expect(snap.topReferrers).toEqual([["chatgpt.com", 2]]);
        expect(snap.topCountries).toHaveLength(2);
    });

    test("404s an unknown path", async () => {
        const site = makeSite();
        const response = await site.fetch(new Request("https://realtime/nope"));
        expect(response.status).toBe(404);
    });
});

describe("visitorKey", () => {
    function request(ip: string, ua: string) {
        return new Request("https://example.com/collect", {
            headers: { "cf-connecting-ip": ip, "user-agent": ua },
        });
    }

    test("is stable for the same person within a day", async () => {
        const a = await visitorKey("s", request("1.2.3.4", "UA"), "salt");
        const b = await visitorKey("s", request("1.2.3.4", "UA"), "salt");
        expect(a).toBe(b);
    });

    test("differs by IP, user agent, site and salt", async () => {
        const base = await visitorKey("s", request("1.2.3.4", "UA"), "salt");
        expect(await visitorKey("s", request("9.9.9.9", "UA"), "salt")).not.toBe(base);
        expect(await visitorKey("s", request("1.2.3.4", "Other"), "salt")).not.toBe(base);
        expect(await visitorKey("other", request("1.2.3.4", "UA"), "salt")).not.toBe(base);
        // A different salt must not produce the same key, or rotating it would
        // not actually break correlation.
        expect(await visitorKey("s", request("1.2.3.4", "UA"), "other")).not.toBe(base);
    });

    test("is short and opaque", async () => {
        const key = await visitorKey("s", request("1.2.3.4", "UA"), "salt");
        expect(key).toMatch(/^[0-9a-f]{16}$/);
        // The inputs must not be recoverable from it.
        expect(key).not.toContain("1.2.3.4");
    });
});

describe("pushRealtimeHit", () => {
    test("does nothing without a namespace", async () => {
        await expect(
            pushRealtimeHit(undefined, { siteId: "s", visitor: "a" }),
        ).resolves.toBeUndefined();
    });

    test("swallows a failing namespace rather than breaking the pixel", async () => {
        const namespace = {
            idFromName: () => ({}),
            get: () => ({
                fetch: () => Promise.reject(new Error("object down")),
            }),
        } as unknown as DurableObjectNamespace;

        await expect(
            pushRealtimeHit(namespace, { siteId: "s", visitor: "a" }),
        ).resolves.toBeUndefined();
    });
});
