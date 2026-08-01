import { describe, expect, test } from "vitest";
import { readApiQuery } from "../api-input";

describe("public API input", () => {
    test("defaults to a bounded seven-day query", () => {
        expect(readApiQuery(new Request("https://stats.example.com/api/v1/analytics?site=example.com"))).toMatchObject({
            site: "example.com", interval: "7d", timezone: "UTC", limit: 20,
        });
    });

    test("accepts bounded custom ranges", () => {
        expect(readApiQuery(new Request("https://stats.example.com/api/v1/analytics?site=example.com&interval=2026-07-01..2026-07-31"))).toMatchObject({
            interval: "2026-07-01..2026-07-31",
        });
    });

    test("rejects SQL control characters in filters", () => {
        expect(() => readApiQuery(new Request("https://stats.example.com/api/v1/analytics?site=example.com&path=%27%20OR%201%3D1"))).toThrow(Response);
    });

    test("rejects unbounded ranges and invalid timezones", () => {
        expect(() => readApiQuery(new Request("https://stats.example.com/api/v1/analytics?site=example.com&interval=2020-01-01..2026-01-01"))).toThrow(Response);
        expect(() => readApiQuery(new Request("https://stats.example.com/api/v1/analytics?site=example.com&timezone=Nope/Nowhere"))).toThrow(Response);
    });
});
