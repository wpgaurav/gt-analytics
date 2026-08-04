import { describe, expect, test } from "vitest";

import {
    aggregateByDimension,
    seriesByDay,
    totalsForSite,
    type ArchiveRow,
} from "../archive";

const rows: ArchiveRow[] = [
    {
        date: "2026-08-04",
        siteId: "site-a",
        path: "/one",
        browserName: "Chrome",
        visitorKey: "daily-a",
        views: 2,
        visitors: 0,
        bounces: 1,
    },
    {
        date: "2026-08-04",
        siteId: "site-a",
        path: "/one",
        browserName: "Safari",
        visitorKey: "daily-a",
        views: 1,
        visitors: 0,
        bounces: -1,
    },
    {
        date: "2026-08-04",
        siteId: "site-a",
        path: "/two",
        browserName: "Safari",
        visitorKey: "daily-a",
        views: 1,
        visitors: 0,
        bounces: 0,
    },
    {
        date: "2026-08-04",
        siteId: "site-a",
        path: "/one",
        browserName: "Firefox",
        visitorKey: "daily-b",
        views: 1,
        visitors: 0,
        bounces: 1,
    },
    // A pre-migration/imported row has no key and keeps its additive measure.
    {
        date: "2026-08-04",
        siteId: "site-a",
        path: "/legacy",
        browserName: "",
        views: 3,
        visitors: 2,
        bounces: 1,
    },
];

describe("privacy-preserving archive visitor counts", () => {
    test("deduplicates visitor keys for site totals", () => {
        expect(totalsForSite(rows, "site-a")).toEqual({
            views: 8,
            visitors: 4,
            bounces: 2,
        });
    });

    test("deduplicates independently inside each reported dimension", () => {
        expect(
            aggregateByDimension(rows, {
                siteId: "site-a",
                dimension: "path",
                limit: 10,
            }),
        ).toEqual([
            ["/one", 2, 4],
            ["/legacy", 2, 3],
            ["/two", 1, 1],
        ]);
    });

    test("deduplicates the daily series without losing legacy counts", () => {
        expect(seriesByDay(rows, "site-a")).toEqual([
            {
                date: "2026-08-04",
                views: 8,
                visitors: 4,
                bounces: 2,
            },
        ]);
    });
});
