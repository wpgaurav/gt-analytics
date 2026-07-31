import { describe, expect, test, vi } from "vitest";

import { buildEventDataPoint, writeEventDataPoint } from "../events";

describe("buildEventDataPoint", () => {
    test("requires a site id and a name", () => {
        expect(buildEventDataPoint({ n: "signup" })).toEqual({
            error: "Missing siteId",
        });
        expect(buildEventDataPoint({ sid: "example.com" })).toEqual({
            error: "Missing event name",
        });
    });

    test("builds a conversion with value and currency", () => {
        const result = buildEventDataPoint({
            sid: "example.com",
            n: "purchase",
            t: "conversion",
            h: "example.com",
            p: "/pricing/",
            v: "4900",
            cur: "inr",
            l: "annual",
        });

        expect(result).toMatchObject({
            siteId: "example.com",
            name: "purchase",
            type: "conversion",
            path: "/pricing/",
            value: 4900,
            currency: "INR",
            label: "annual",
        });
    });

    test("anything that is not 'conversion' is a plain event", () => {
        expect(
            buildEventDataPoint({ sid: "s", n: "download", t: "banana" }),
        ).toMatchObject({ type: "event" });
        expect(buildEventDataPoint({ sid: "s", n: "download" })).toMatchObject({
            type: "event",
        });
    });

    test("a non-numeric value becomes zero rather than NaN", () => {
        // NaN in the column would poison every SUM over it.
        const result = buildEventDataPoint({
            sid: "s",
            n: "x",
            v: "not-a-number",
        });
        expect(result).toMatchObject({ value: 0 });
    });

    test("attributes the event to its referrer", () => {
        const result = buildEventDataPoint({
            sid: "example.com",
            n: "signup",
            h: "example.com",
            r: "https://www.google.com/",
        });
        expect(result).toMatchObject({
            referrerHost: "google.com",
            channel: "search",
        });
    });

    test("falls back to the session referrer when the immediate one is internal", () => {
        const result = buildEventDataPoint({
            sid: "example.com",
            n: "signup",
            h: "example.com",
            // Converting on a later page, so the immediate referrer is our own
            // site; without the session referrer this would be unattributed.
            r: "https://example.com/pricing/",
            sr: "https://chatgpt.com/",
        });
        expect(result).toMatchObject({
            referrerHost: "chatgpt.com",
            channel: "ai",
        });
    });

    test("records a click id by name and marks the event paid", () => {
        const result = buildEventDataPoint({
            sid: "example.com",
            n: "purchase",
            h: "example.com",
            ci: "gclid",
        });
        expect(result).toMatchObject({ clickId: "gclid", channel: "paid" });
    });

    test("truncates over-long names and labels", () => {
        const result = buildEventDataPoint({
            sid: "s",
            n: "x".repeat(200),
            l: "y".repeat(400),
        });
        if ("error" in result) throw new Error("expected a datapoint");
        expect(result.name.length).toBe(64);
        expect(result.label!.length).toBe(128);
    });
});

describe("writeEventDataPoint", () => {
    const data = {
        siteId: "example.com",
        name: "signup",
        type: "conversion",
        value: 10,
    };

    test("writes the site id as both index and blob1", () => {
        const dataset = { writeDataPoint: vi.fn() };
        writeEventDataPoint(dataset as unknown as AnalyticsEngineDataset, data);

        const written = dataset.writeDataPoint.mock.calls[0][0];
        expect(written.indexes).toEqual(["example.com"]);
        expect(written.blobs[0]).toBe("example.com");
        expect(written.blobs[1]).toBe("signup");
        expect(written.blobs[2]).toBe("conversion");
        expect(written.doubles).toEqual([10]);
    });

    test("does not throw when the dataset binding is missing", () => {
        // A misconfigured binding must not turn every conversion into a 500.
        expect(() => writeEventDataPoint(undefined, data)).not.toThrow();
    });
});
