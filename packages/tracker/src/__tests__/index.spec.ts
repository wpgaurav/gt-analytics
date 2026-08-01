import { describe, test, expect, beforeAll, afterEach, vi } from "vitest";

import * as Counterscale from "../index";
import * as requestModule from "../lib/request";
import { Client } from "~/lib/client";

describe("api", () => {
    let beaconUrls: string[] = [];
    beforeAll(() => {
        vi.spyOn(requestModule, "nextHitType").mockReturnValue("1");
        Object.defineProperty(navigator, "sendBeacon", {
            configurable: true,
            value: vi.fn((url: string) => {
                beaconUrls.push(String(url));
                return true;
            }),
        });
    });

    afterEach(() => {
        beaconUrls = [];
        Counterscale.cleanup();
    });

    describe("init", () => {
        test("initializes", () => {
            Counterscale.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });
        });
        test("does not error when init is called twice", () => {
            expect(() => {
                Counterscale.init({
                    siteId: "test-id",
                    reporterUrl: "https://example.com/collect",
                    autoTrackPageviews: false,
                });
                Counterscale.init({
                    siteId: "test-id",
                    reporterUrl: "https://example.com/collect",
                    autoTrackPageviews: false,
                });
            }).not.toThrow();
        });
    });

    describe("isInitialized", () => {
        test("returns true when init has been called", () => {
            Counterscale.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });
            expect(Counterscale.isInitialized()).toBe(true);
        });
        test("returns false when init has not been called", () => {
            expect(Counterscale.isInitialized()).toBe(false);
        });
    });

    describe("getInitializedClient", () => {
        test("returns an instance of a client if called after init", () => {
            Counterscale.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            expect(Counterscale.getInitializedClient()).toBeInstanceOf(Client);
        });

        test("returns undefined if called without init", () => {
            expect(Counterscale.getInitializedClient()).toBeUndefined();
        });
    });

    describe("trackPageview", () => {
        test("records a pageview for the current url", async () => {
            Counterscale.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(beaconUrls).toHaveLength(0);

            await Counterscale.trackPageview();

            expect(beaconUrls).toHaveLength(1);

            const searchParams = new URL(beaconUrls[0]).searchParams;
            expect(searchParams.get("sid")).toBe("test-id");
            expect(searchParams.get("h")).toBe("http://localhost");
            expect(searchParams.get("p")).toBe("/"); // default path when running test w/ jsdom
            expect(searchParams.get("r")).toBe("");
            expect(searchParams.get("ht")).toBe("1"); // First hit (new visit)
        });

        test("records a pageview for the given url and referrer", async () => {
            Counterscale.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(beaconUrls).toHaveLength(0);

            await Counterscale.trackPageview({
                url: "https://example.com/foo",
                referrer: "https://referrer.com/",
            });

            expect(beaconUrls).toHaveLength(1);

            const searchParams = new URL(beaconUrls[0]).searchParams;
            expect(searchParams.get("sid")).toBe("test-id");
            expect(searchParams.get("h")).toBe("https://example.com");
            expect(searchParams.get("p")).toBe("/foo");
            expect(searchParams.get("r")).toBe("https://referrer.com/");
            expect(searchParams.get("ht")).toBe("1"); // First hit (new visit)
        });
    });

    describe("autoTrackPageviews", () => {
        test("initializes with autoTrackPageviews", async () => {
            // Initialize with autoTrackPageviews: true
            Counterscale.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: true,
            });

            // Wait for setTimeout in the Client constructor to execute
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Check that at least one XHR request was made (initial pageview)
            expect(beaconUrls.length).toBeGreaterThan(0);

            // Trigger a navigation event
            window.dispatchEvent(new Event("popstate"));

            // Wait for the navigation event to be processed
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Check that another XHR request was made (after navigation)
            const initialCount = beaconUrls.length;
            expect(initialCount).toBeGreaterThan(1);

            // Trigger another navigation event
            window.history.pushState({}, "", "/another-page");
            window.dispatchEvent(new Event("popstate"));

            // Wait for the second navigation event to be processed
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Check that a third XHR request was made
            expect(beaconUrls.length).toBeGreaterThan(initialCount);
        });
    });

    describe("reportOnLocalhost", () => {
        test("should not report on localhost by default", async () => {
            Counterscale.init({
                siteId: "test-id",
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(beaconUrls).toHaveLength(0);

            await Counterscale.trackPageview({
                url: "https://example.com/foo",
                referrer: "https://referrer.com/",
            });

            expect(beaconUrls).toHaveLength(0);
        });

        test("should report on localhost when reportOnLocalhost is set to true", async () => {
            Counterscale.init({
                siteId: "test-id",
                reportOnLocalhost: true,
                reporterUrl: "https://example.com/collect",
                autoTrackPageviews: false,
            });

            // since auto: false, no requests should be made yet
            expect(beaconUrls).toHaveLength(0);

            await Counterscale.trackPageview({
                url: "https://example.com/foo",
                referrer: "https://referrer.com/",
            });

            expect(beaconUrls).toHaveLength(1);
        });
    });
});
