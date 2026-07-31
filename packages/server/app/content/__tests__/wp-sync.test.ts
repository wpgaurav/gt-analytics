import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";

import { syncSite } from "../wp-sync";
import type { Site } from "../sites";

/**
 * Regression tests for the content sync's pagination.
 *
 * The first implementation advanced the `modified_after` cursor on every page
 * while also incrementing `page`. Both parameters filter the same result set,
 * so each page re-based the window and skipped the records the previous pages
 * had already moved past. It looked like it worked -- no error, plausible
 * numbers -- but pulled 1,337 of 3,081 objects. These tests pin the contract
 * that broke.
 */

const SITE: Site = {
    site_id: "example.com",
    label: "Example",
    wp_base_url: "https://example.com",
    wp_admin_url: null,
    timezone: "UTC",
    enabled: 1,
    wp_sync_enabled: 1,
    created_at: "",
    updated_at: "",
};

/** Minimal D1 stand-in: records nothing, satisfies the calls sync makes. */
function fakeDb(cursor: string | null = null): D1Database {
    const statement = {
        bind: () => statement,
        first: async () => (cursor ? { cursor_modified: cursor } : null),
        all: async () => ({ results: [] }),
        run: async () => ({}),
    };
    return {
        prepare: () => statement,
        batch: async (stmts: unknown[]) => stmts.map(() => ({})),
    } as unknown as D1Database;
}

function fakeKv() {
    const store: Record<string, string> = {};
    return {
        kv: {
            put: async (key: string, value: string) => {
                store[key] = value;
            },
            get: async (key: string) => store[key] ?? null,
            delete: async (key: string) => {
                delete store[key];
            },
        } as unknown as KVNamespace,
        store,
    };
}

function item(id: number, modified: string) {
    return {
        id,
        slug: `post-${id}`,
        link: `https://example.com/post-${id}/`,
        type: "post",
        status: "publish",
        date_gmt: "2026-01-01T00:00:00",
        modified_gmt: modified,
        author: 1,
        categories: [5],
        tags: [],
        title: { rendered: `Post ${id}` },
    };
}

let fetchMock: Mock;

beforeEach(() => {
    fetchMock = global.fetch = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Serves N items across pages of 100, recording every URL requested. */
function serve(total: number, urls: string[]) {
    fetchMock.mockImplementation(async (url: string) => {
        urls.push(url);

        if (url.includes("/wp-json/wp/v2/types")) {
            return {
                ok: true,
                json: async () => ({
                    post: { slug: "post", rest_base: "posts" },
                }),
            };
        }

        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        const start = (page - 1) * 100;
        const slice = Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (_, i) =>
            item(start + i + 1, `2026-01-01T00:${String((start + i) % 60).padStart(2, "0")}:00`),
        );

        return { ok: true, json: async () => slice };
    });
}

describe("content sync pagination", () => {
    test("keeps modified_after fixed while paging", async () => {
        const urls: string[] = [];
        serve(250, urls);
        const { kv } = fakeKv();

        await syncSite(fakeDb("2025-06-01T00:00:00"), kv, SITE);

        const contentUrls = urls.filter((u) => u.includes("/posts"));
        const cursors = contentUrls.map((u) =>
            new URL(u).searchParams.get("modified_after"),
        );

        expect(contentUrls.length).toBeGreaterThan(1);
        // Every page must ask from the same baseline. If this set has more
        // than one member, the window is moving and records are being skipped.
        expect(new Set(cursors).size).toBe(1);
        expect(cursors[0]).toBe("2025-06-01T00:00:00");
    });

    test("increments page across the run", async () => {
        const urls: string[] = [];
        serve(250, urls);
        const { kv } = fakeKv();

        await syncSite(fakeDb(), kv, SITE);

        const pages = urls
            .filter((u) => u.includes("/posts"))
            .map((u) => Number(new URL(u).searchParams.get("page")));

        expect(pages).toEqual([1, 2, 3]);
    });

    test("walks every page of a multi-page type", async () => {
        const urls: string[] = [];
        serve(250, urls);
        const { kv } = fakeKv();

        const result = await syncSite(fakeDb(), kv, SITE);

        expect(result.status).toBe("ok");
        // 100 + 100 + 50: the short final page ends the loop.
        expect(result.types[0].seen).toBe(250);
    });

    test("omits modified_after entirely on a first run", async () => {
        const urls: string[] = [];
        serve(50, urls);
        const { kv } = fakeKv();

        await syncSite(fakeDb(null), kv, SITE);

        const contentUrl = urls.find((u) => u.includes("/posts"))!;
        expect(new URL(contentUrl).searchParams.get("modified_after")).toBeNull();
    });

    test("stops when a page comes back empty", async () => {
        const urls: string[] = [];
        serve(0, urls);
        const { kv } = fakeKv();

        const result = await syncSite(fakeDb(), kv, SITE);

        expect(result.types[0].seen).toBe(0);
        expect(urls.filter((u) => u.includes("/posts")).length).toBe(1);
    });

    test("refuses to sync a site with WordPress sync disabled", async () => {
        const { kv } = fakeKv();
        const result = await syncSite(fakeDb(), kv, {
            ...SITE,
            wp_sync_enabled: 0,
        });

        expect(result.status).toBe("error");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
