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

import { createFetchResponse, getDefaultContext } from "./testutils";
import { loader } from "../resources.paths";

vi.mock("~/lib/api-auth", () => ({
    requireApiAuth: vi.fn(),
}));

describe("Resources/Paths route", () => {
    let fetch: Mock;

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
    describe("loader", () => {
        test("returns valid json", async () => {
            fetch.mockResolvedValue(
                createFetchResponse({
                    data: [
                        { value: "/", visitors: "2", views: "7" },
                        {
                            value: "/example",
                            visitors: "4",
                            views: "10",
                        },
                    ],
                }),
            );

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/paths", // no site query param
                },
            });

            expect(fetch).toHaveBeenCalledTimes(1);

            const json = await response;

            expect(json).toEqual({
                countsByProperty: [
                    ["/example", 4, 10],
                    ["/", 2, 7],
                ],
                page: 1,
            });
        });
    });
});
