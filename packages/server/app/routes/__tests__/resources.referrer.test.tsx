// @vitest-environment jsdom
import {
    vi,
    test,
    describe,
    beforeEach,
    afterEach,
    expect,
    Mock,
} from "vitest";
import "vitest-dom/extend-expect";

import { loader } from "../resources.referrer";
import { createFetchResponse, getDefaultContext } from "./testutils";

vi.mock("~/lib/api-auth", () => ({
    requireApiAuth: vi.fn(),
}));

describe("Resources/Referrer route", () => {
    let fetch: Mock;

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("loader", () => {
        test("groups referrers by source, summing their URLs", async () => {
            // URL rows retain drill-down detail.
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        {
                            host: "chatgpt.com",
                            url: "https://chatgpt.com/",
                            views: "40",
                            visitors: "10",
                        },
                        {
                            host: "chatgpt.com",
                            url: "https://chatgpt.com/c/abc",
                            views: "30",
                            visitors: "16",
                        },
                        {
                            host: "bing.com",
                            url: "https://www.bing.com/",
                            views: "6",
                            visitors: "5",
                        },
                        {
                            // A different host that carries the same display
                            // name must merge, not make a second Bing row.
                            host: "cn.bing.com",
                            url: "https://cn.bing.com/",
                            views: "1",
                            visitors: "1",
                        },
                    ],
                }),
            );
            // Host rows are counted separately so one visitor using two URLs
            // on the same source is not counted twice in the parent.
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        {
                            host: "chatgpt.com",
                            views: "70",
                            visitors: "20",
                        },
                        { host: "bing.com", views: "6", visitors: "5" },
                        { host: "cn.bing.com", views: "1", visitors: "1" },
                    ],
                }),
            );

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/referrer",
                },
            });

            expect(fetch).toHaveBeenCalledTimes(2);

            const json = (await response) as {
                groups: {
                    name: string;
                    views: number;
                    visitors: number;
                    urls: { url: string }[];
                }[];
            };

            expect(json.groups.map((g) => g.name)).toEqual(["ChatGPT", "Bing"]);

            const chatgpt = json.groups[0];
            expect(chatgpt.views).toBe(70);
            expect(chatgpt.visitors).toBe(20);
            expect(chatgpt.urls).toHaveLength(2);

            const bing = json.groups[1];
            expect(bing.views).toBe(7);
            expect(bing.visitors).toBe(6);
            expect(bing.urls.map((u) => u.url)).toEqual([
                "https://www.bing.com/",
                "https://cn.bing.com/",
            ]);
        });

        test("merges URLs that read identically", async () => {
            // "https://chatgpt.com" and "https://chatgpt.com/" are the same
            // page; listing both is noise rather than precision.
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        {
                            host: "chatgpt.com",
                            url: "https://chatgpt.com/",
                            views: "4",
                            visitors: "2",
                        },
                        {
                            host: "chatgpt.com",
                            url: "https://chatgpt.com",
                            views: "3",
                            visitors: "1",
                        },
                    ],
                }),
            );
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [{ host: "chatgpt.com", views: "7", visitors: "2" }],
                }),
            );

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error partial request
                request: { url: "http://localhost:3000/resources/referrer" },
            });

            const json = (await response) as {
                groups: { urls: { views: number }[]; views: number }[];
            };

            expect(json.groups[0].urls).toHaveLength(1);
            expect(json.groups[0].urls[0].views).toBe(7);
            expect(json.groups[0].views).toBe(7);
        });
    });
});
