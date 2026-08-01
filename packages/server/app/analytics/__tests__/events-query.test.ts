import { afterEach, describe, expect, test, vi } from "vitest";

import { EventsAPI } from "../events-query";

describe("EventsAPI.getEventBreakdown", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("returns aggregate attribution context without individual visitor data", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            Response.json({
                data: [
                    {
                        name: "purchase",
                        type: "conversion",
                        path: "/checkout/",
                        label: "annual",
                        channel: "paid",
                        referrerHost: "google.com",
                        utmSource: "google",
                        utmMedium: "cpc",
                        utmCampaign: "launch",
                        country: "IN",
                        currency: "INR",
                        count: "3",
                        value: "14700",
                    },
                ],
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const api = new EventsAPI("account", "token", "events_dataset");
        await expect(
            api.getEventBreakdown(
                "example.com",
                "30d",
                "Asia/Kolkata",
                "conversion",
                500,
                { channel: "paid", utmCampaign: "launch" },
            ),
        ).resolves.toEqual([
            expect.objectContaining({
                name: "purchase",
                path: "/checkout/",
                label: "annual",
                channel: "paid",
                currency: "INR",
                count: 3,
                value: 14700,
            }),
        ]);

        const sql = fetchMock.mock.calls[0][1].body as string;
        expect(sql).toContain("blob3 = 'conversion'");
        expect(sql).toContain("blob7 = 'paid'");
        expect(sql).toContain("blob10 = 'launch'");
        expect(sql).toContain("GROUP BY name, type, path, label, channel");
        expect(sql).not.toContain("visitor");
    });
});
