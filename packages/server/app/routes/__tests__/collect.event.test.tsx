import { describe, expect, test, vi } from "vitest";

import { action, loader } from "../collect.event";

function createContext() {
    const writeDataPoint = vi.fn();

    return {
        context: {
            cloudflare: {
                cf: { country: "IN" },
                env: {
                    EVENTS_AE: { writeDataPoint },
                },
            },
        },
        writeDataPoint,
    };
}

const eventUrl =
    "https://stats.example.com/collect/event" +
    "?sid=example.com&n=duration&t=event&h=example.com&p=%2Fguide%2F&v=42";

describe("collect.event route", () => {
    test("accepts navigator.sendBeacon POST requests", async () => {
        const { context, writeDataPoint } = createContext();
        const request = new Request(eventUrl, { method: "POST" });

        const response = await action({
            request,
            context,
            params: {},
        } as never);

        expect(response.status).toBe(204);
        expect(writeDataPoint).toHaveBeenCalledOnce();
        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ["example.com"],
                doubles: [42],
                blobs: expect.arrayContaining([
                    "example.com",
                    "duration",
                    "event",
                    "/guide/",
                ]),
            }),
        );
    });

    test("continues accepting image fallback GET requests", async () => {
        const { context, writeDataPoint } = createContext();
        const request = new Request(eventUrl);

        const response = await loader({
            request,
            context,
            params: {},
        } as never);

        expect(response.status).toBe(204);
        expect(writeDataPoint).toHaveBeenCalledOnce();
    });
});
