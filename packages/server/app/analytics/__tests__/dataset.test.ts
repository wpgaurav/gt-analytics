import { describe, expect, test, vi, beforeEach, afterEach, Mock } from "vitest";

import { AnalyticsEngineAPI, DEFAULT_DATASET } from "../query";

/**
 * Regression guard for a bug that ran in production.
 *
 * The wrangler `analytics_engine_datasets` binding was renamed to
 * `counterscale_gauravtiwari_metrics`, but every SQL string in query.ts still
 * said `FROM metricsDataset`. Writes went to the renamed dataset, reads went to
 * an empty one, and the dashboard silently returned zero rows for weeks -- no
 * error, no warning, just nothing.
 *
 * These tests assert the dataset name reaches the generated SQL, so the read
 * and write sides can never drift apart unnoticed again.
 */

const CUSTOM_DATASET = "counterscale_gauravtiwari_metrics";

function createFetchResponse<T>(data: T) {
    return {
        ok: true,
        json: () => new Promise<T>((resolve) => resolve(data)),
    };
}

describe("Analytics Engine dataset configuration", () => {
    let fetch: Mock;

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
        fetch.mockResolvedValue(createFetchResponse({ data: [] }));
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function sqlSent() {
        return fetch.mock.calls.map((call) => String(call[1].body));
    }

    test("falls back to the upstream dataset name when unconfigured", () => {
        expect(new AnalyticsEngineAPI("acct", "token").dataset).toBe(
            DEFAULT_DATASET,
        );
    });

    test("falls back when handed an empty string", () => {
        // An unset wrangler var arrives as "" rather than undefined, which
        // would otherwise produce `FROM ` and a syntax error.
        expect(new AnalyticsEngineAPI("acct", "token", "").dataset).toBe(
            DEFAULT_DATASET,
        );
    });

    test("uses the configured dataset in every query method", async () => {
        const api = new AnalyticsEngineAPI("acct", "token", CUSTOM_DATASET);
        const start = new Date("2026-07-01T00:00:00Z");
        const end = new Date("2026-07-31T00:00:00Z");

        await Promise.all([
            api.getViewsGroupedByInterval("site", "DAY", start, end, "UTC"),
            api.getCounts("site", "7d"),
            api.getVisitorCountByColumn("site", "path", "7d"),
            api.getAllCountsByColumn("site", "path", "7d"),
            api.getSitesOrderedByHits("7d"),
            api.getEarliestEvents("site"),
            api.getAllCountsByAllColumnsForAllSites(["path"], start, end),
        ]);

        const queries = sqlSent();
        expect(queries.length).toBeGreaterThanOrEqual(7);

        for (const sql of queries) {
            expect(sql).toContain(`FROM ${CUSTOM_DATASET}`);
            expect(sql).not.toContain(DEFAULT_DATASET);
        }
    });

    test("no query string hardcodes a dataset name", async () => {
        const api = new AnalyticsEngineAPI("acct", "token", "someOtherDataset");
        await api.getCounts("site", "7d");

        for (const sql of sqlSent()) {
            // Exactly one FROM clause, and it is the configured one.
            const fromClauses = sql.match(/FROM\s+(\S+)/g) ?? [];
            expect(fromClauses.length).toBeGreaterThan(0);
            for (const clause of fromClauses) {
                expect(clause).toBe("FROM someOtherDataset");
            }
        }
    });
});
