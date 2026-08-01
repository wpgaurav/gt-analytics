import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { nextHitType, sendBeaconRequest } from "../request";

describe("reliable browser transport", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    test("caps same-day hit state and resets on a new UTC day", () => {
        expect(nextHitType("site")).toBe("1");
        expect(nextHitType("site")).toBe("2");
        expect(nextHitType("site")).toBe("3");
        expect(nextHitType("site")).toBe("3");

        vi.setSystemTime(new Date("2026-08-02T00:00:01Z"));
        expect(nextHitType("site")).toBe("1");
    });

    test("queues collection with sendBeacon", () => {
        const beacon = vi.fn(() => true);
        Object.defineProperty(navigator, "sendBeacon", {
            configurable: true,
            value: beacon,
        });

        sendBeaconRequest("https://analytics.example/collect?sid=site");

        expect(beacon).toHaveBeenCalledWith(
            "https://analytics.example/collect?sid=site",
        );
    });
});
