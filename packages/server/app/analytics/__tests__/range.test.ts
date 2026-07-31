import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

import {
    AE_RETENTION_DAYS,
    formatCustomRange,
    isCustomRange,
    parseRange,
    rangeToSql,
    routeRange,
} from "../range";
import { datesInRange } from "../archive";

// Fixed so "90 days ago" is a specific date rather than whatever today is.
const NOW = new Date("2026-07-31T12:00:00Z");

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("parseRange", () => {
    test("named intervals include today", () => {
        const range = parseRange("7d", "UTC");
        expect(range.end).toBe("2026-07-31");
        // 7 days means 7, not 8: the 25th through the 31st inclusive.
        expect(range.start).toBe("2026-07-25");
        expect(range.days).toBe(7);
        expect(range.includesToday).toBe(true);
    });

    test("yesterday is a single day and excludes today", () => {
        const range = parseRange("yesterday", "UTC");
        expect(range).toMatchObject({
            start: "2026-07-30",
            end: "2026-07-30",
            days: 1,
            includesToday: false,
        });
    });

    test("parses an explicit range", () => {
        const range = parseRange("2026-04-05..2026-06-01", "UTC");
        expect(range).toMatchObject({
            start: "2026-04-05",
            end: "2026-06-01",
            includesToday: false,
        });
        expect(range.days).toBe(58);
    });

    test("a reversed range is read in the order that makes sense", () => {
        expect(parseRange("2026-06-01..2026-04-05", "UTC")).toMatchObject({
            start: "2026-04-05",
            end: "2026-06-01",
        });
    });

    test("never claims to cover days that have not happened", () => {
        const range = parseRange("2026-07-01..2027-12-31", "UTC");
        expect(range.end).toBe("2026-07-31");
    });

    test("an unparseable interval falls back rather than throwing", () => {
        // This reads a URL parameter, so anyone can type anything into it.
        expect(parseRange("garbage", "UTC").days).toBe(7);
    });
});

describe("routeRange", () => {
    const tz = "UTC";

    test("a recent range is answered by Analytics Engine alone", () => {
        const route = routeRange(parseRange("30d", tz), { tz });
        expect(route.source).toBe("ae");
        expect(route.archiveStart).toBeNull();
    });

    test("an old range is answered by the archive alone", () => {
        const route = routeRange(parseRange("2024-01-01..2024-03-01", tz), {
            tz,
        });
        expect(route.source).toBe("archive");
        expect(route.aeStart).toBeNull();
        expect(route.archiveStart).toBe("2024-01-01");
        expect(route.archiveEnd).toBe("2024-03-01");
    });

    test("a straddling range splits across both stores without overlapping", () => {
        const route = routeRange(parseRange("2026-01-01..2026-07-31", tz), {
            tz,
        });
        expect(route.source).toBe("both");

        // The critical property: every day is claimed by exactly one store.
        // An overlap would double every number on the page and would be
        // invisible in the output.
        const archived = datesInRange(route.archiveStart!, route.archiveEnd!);
        const live = datesInRange(route.aeStart!, route.aeEnd!);
        const overlap = archived.filter((date) => live.includes(date));
        expect(overlap).toEqual([]);

        // And no day is dropped between them either.
        expect(archived.length + live.length).toBe(
            datesInRange("2026-01-01", "2026-07-31").length,
        );
    });

    test("the archive is not asked for days before it holds anything", () => {
        const route = routeRange(parseRange("2020-01-01..2026-07-31", tz), {
            tz,
            archiveEarliest: "2026-04-05",
        });
        expect(route.archiveStart).toBe("2026-04-05");
    });

    test("the retention boundary is treated as one day short", () => {
        // A query that takes a second to run can otherwise land the other side
        // of the boundary and come back silently short.
        expect(AE_RETENTION_DAYS).toBeLessThan(90);
    });
});

describe("rangeToSql", () => {
    test("the end bound covers the whole final day", () => {
        const { startIntervalSql, endIntervalSql } = rangeToSql(
            "2026-07-01",
            "2026-07-31",
            "UTC",
        );
        expect(startIntervalSql).toContain("2026-07-01 00:00:00");
        // Exclusive end at the start of the next day, so the 31st is included
        // whole rather than being cut off at midnight.
        expect(endIntervalSql).toContain("2026-08-01 00:00:00");
    });
});

describe("custom range formatting", () => {
    test("round-trips", () => {
        const token = formatCustomRange("2026-04-05", "2026-07-31");
        expect(isCustomRange(token)).toBe(true);
        expect(parseRange(token, "UTC")).toMatchObject({
            start: "2026-04-05",
            end: "2026-07-31",
        });
    });

    test("named intervals are not mistaken for ranges", () => {
        for (const interval of ["7d", "today", "yesterday", "90d", ""]) {
            expect(isCustomRange(interval)).toBe(false);
        }
    });
});
