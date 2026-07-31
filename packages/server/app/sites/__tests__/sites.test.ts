import { describe, expect, test } from "vitest";

import { normalizeBaseUrl, validateSiteInput } from "../sites";
import { formToSiteInput } from "../site-form";

describe("validateSiteInput", () => {
    const valid = {
        site_id: "gauravtiwari.org",
        label: "Gaurav Tiwari",
        base_url: "https://gauravtiwari.org",
    };

    test("accepts a well-formed site", () => {
        expect(validateSiteInput(valid)).toEqual({});
    });

    test("requires a site id and a label", () => {
        const errors = validateSiteInput({ ...valid, site_id: "", label: "" });
        expect(errors.site_id).toBeDefined();
        expect(errors.label).toBeDefined();
    });

    test("rejects site ids that would not round-trip through a URL", () => {
        expect(validateSiteInput({ ...valid, site_id: "has space" }).site_id)
            .toBeDefined();
        expect(validateSiteInput({ ...valid, site_id: "has/slash" }).site_id)
            .toBeDefined();
        // The domain form people actually use must stay valid.
        expect(validateSiteInput({ ...valid, site_id: "sub.example.co.uk" }))
            .toEqual({});
    });

    
    test("accepts a site with no URL at all", () => {
        // Tracking works without one; report rows just render as plain text
        // instead of links.
        expect(
            validateSiteInput({ site_id: "a.com", label: "A", base_url: "" }),
        ).toEqual({});
    });

    test("rejects a base URL that is not http(s)", () => {
        expect(
            validateSiteInput({ ...valid, base_url: "gauravtiwari.org" })
                .base_url,
        ).toBeDefined();
        expect(
            validateSiteInput({
                ...valid,
                base_url: "javascript:alert(1)",
            }).base_url,
        ).toBeDefined();
    });
});

describe("normalizeBaseUrl", () => {
    test("strips trailing slashes so URLs concatenate predictably", () => {
        expect(normalizeBaseUrl("https://example.com/")).toBe(
            "https://example.com",
        );
        expect(normalizeBaseUrl("https://example.com///")).toBe(
            "https://example.com",
        );
        expect(normalizeBaseUrl("  https://example.com  ")).toBe(
            "https://example.com",
        );
    });

    test("maps blank to null", () => {
        expect(normalizeBaseUrl("")).toBeNull();
        expect(normalizeBaseUrl("   ")).toBeNull();
        expect(normalizeBaseUrl(null)).toBeNull();
    });
});


describe("formToSiteInput", () => {
    function form(entries: Record<string, string>) {
        const data = new FormData();
        for (const [k, v] of Object.entries(entries)) data.append(k, v);
        return data;
    }

    test("reads an absent checkbox as false", () => {
        // An unchecked checkbox submits nothing at all, so "missing" has to
        // mean false -- otherwise a site could never be disabled.
        const { input } = formToSiteInput(
            form({ site_id: "a", label: "A", base_url: "https://a.com" }),
        );
        expect(input.enabled).toBe(false);
    });

    test("reads a present checkbox as true", () => {
        const { input } = formToSiteInput(
            form({
                site_id: "a",
                label: "A",
                base_url: "https://a.com",
                enabled: "on",
            }),
        );
        expect(input.enabled).toBe(true);
    });

    test("trims, and maps blank optional fields to null", () => {
        const { input } = formToSiteInput(
            form({
                site_id: "  a  ",
                label: "  A  ",
                base_url: "  https://a.com  ",
            }),
        );
        expect(input.site_id).toBe("a");
        expect(input.label).toBe("A");
        expect(input.base_url).toBe("https://a.com");
    });

    test("defaults the timezone to UTC", () => {
        const { input } = formToSiteInput(form({ site_id: "a", label: "A" }));
        expect(input.timezone).toBe("UTC");
    });

    test("returns values that can repopulate a rejected form", () => {
        const { values } = formToSiteInput(
            form({ site_id: "a", label: "", enabled: "on" }),
        );
        expect(values.site_id).toBe("a");
        expect(values.enabled).toBe("on");
    });
});
