import { describe, expect, test } from "vitest";

import { isNonContentPath, normalizePath } from "../paths";

/**
 * Path normalisation is the join key between recorded hits and WordPress
 * posts. If it is wrong in one direction only, views silently attach to the
 * wrong post or to none -- which looks like "analytics are broken" rather than
 * "the normaliser has a bug", so it is worth pinning down precisely.
 */
describe("normalizePath", () => {
    test("returns / for empty input", () => {
        expect(normalizePath("")).toBe("/");
        expect(normalizePath(null)).toBe("/");
        expect(normalizePath(undefined)).toBe("/");
        expect(normalizePath("   ")).toBe("/");
    });

    test("extracts the path from a full URL", () => {
        expect(normalizePath("https://gauravtiwari.org/some-post/")).toBe(
            "/some-post/",
        );
        expect(normalizePath("http://example.com/a/b/")).toBe("/a/b/");
    });

    test("enforces exactly one leading and trailing slash", () => {
        expect(normalizePath("some-post")).toBe("/some-post/");
        expect(normalizePath("/some-post")).toBe("/some-post/");
        expect(normalizePath("some-post/")).toBe("/some-post/");
        expect(normalizePath("//some-post//")).toBe("/some-post/");
    });

    test("drops query strings and fragments", () => {
        expect(normalizePath("/post/?utm_source=x")).toBe("/post/");
        expect(normalizePath("/post/#section")).toBe("/post/");
        expect(normalizePath("/post/?a=1#b")).toBe("/post/");
    });

    test("lowercases", () => {
        expect(normalizePath("/Some-Post/")).toBe("/some-post/");
    });

    test("percent-decodes, so non-Latin slugs compare equal", () => {
        // A Hindi permalink arrives encoded from the browser and decoded from
        // the REST API. Both must land on the same key.
        expect(normalizePath("/%E0%A4%B9%E0%A4%BF%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%80/"))
            .toBe(normalizePath("/हिन्दी/"));
    });

    test("survives malformed percent-encoding rather than throwing", () => {
        expect(() => normalizePath("/bad%zz/")).not.toThrow();
        expect(normalizePath("/bad%zz/")).toBe("/bad%zz/");
    });

    test("handles the real permalink shapes on these sites", () => {
        expect(normalizePath("https://gauravtiwari.org/go/aawp/")).toBe(
            "/go/aawp/",
        );
        expect(
            normalizePath("https://gauravtiwari.org/course/maths/lesson-1/"),
        ).toBe("/course/maths/lesson-1/");
        expect(normalizePath("https://gauravtiwari.org/deal/black-friday/")).toBe(
            "/deal/black-friday/",
        );
    });

    test("a tracker path and its REST permalink agree", () => {
        // The collector records `?p=` from the browser; the sync derives the
        // key from the REST `link` field. These must converge.
        const fromTracker = normalizePath("/Some-Post?utm_medium=email");
        const fromRest = normalizePath("https://gauravtiwari.org/some-post/");
        expect(fromTracker).toBe(fromRest);
    });
});

describe("isNonContentPath", () => {
    test("flags paths that never map to a single object", () => {
        expect(isNonContentPath("/")).toBe(true);
        expect(isNonContentPath("/wp-admin/")).toBe(true);
        expect(isNonContentPath("/wp-json/wp/v2/posts/")).toBe(true);
        expect(isNonContentPath("/feed/")).toBe(true);
        expect(isNonContentPath("/some-post/feed/")).toBe(true);
    });

    test("leaves ordinary content alone", () => {
        expect(isNonContentPath("/some-post/")).toBe(false);
        expect(isNonContentPath("/go/aawp/")).toBe(false);
    });
});
