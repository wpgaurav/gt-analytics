import { describe, expect, test } from "vitest";

import { adminEditUrl, normalizeBaseUrl, validateSiteInput, type Site } from "../sites";
import { formToSiteInput } from "../site-form";

describe("validateSiteInput", () => {
    const valid = {
        site_id: "gauravtiwari.org",
        label: "Gaurav Tiwari",
        wp_base_url: "https://gauravtiwari.org",
        wp_sync_enabled: true,
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

    test("requires a base URL only when WordPress sync is on", () => {
        expect(
            validateSiteInput({ ...valid, wp_base_url: "" }).wp_base_url,
        ).toBeDefined();

        // A non-WordPress property is legitimate and needs no URL.
        expect(
            validateSiteInput({
                site_id: "example.com",
                label: "Example",
                wp_base_url: "",
                wp_sync_enabled: false,
            }),
        ).toEqual({});
    });

    test("rejects a base URL that is not http(s)", () => {
        expect(
            validateSiteInput({ ...valid, wp_base_url: "gauravtiwari.org" })
                .wp_base_url,
        ).toBeDefined();
        expect(
            validateSiteInput({
                ...valid,
                wp_base_url: "javascript:alert(1)",
            }).wp_base_url,
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

describe("adminEditUrl", () => {
    const base = {
        site_id: "s",
        label: "S",
        timezone: "UTC",
        enabled: 1,
        wp_sync_enabled: 1,
        created_at: "",
        updated_at: "",
    };

    test("prefers an explicit admin URL", () => {
        const site = {
            ...base,
            wp_base_url: "https://example.com",
            wp_admin_url: "https://admin.example.com",
        } as Site;
        expect(adminEditUrl(site, 42)).toBe(
            "https://admin.example.com/post.php?post=42&action=edit",
        );
    });

    test("falls back to the site URL plus /wp-admin", () => {
        const site = {
            ...base,
            wp_base_url: "https://example.com",
            wp_admin_url: null,
        } as Site;
        expect(adminEditUrl(site, 7)).toBe(
            "https://example.com/wp-admin/post.php?post=7&action=edit",
        );
    });

    test("returns null when there is nowhere to link", () => {
        const site = { ...base, wp_base_url: null, wp_admin_url: null } as Site;
        expect(adminEditUrl(site, 7)).toBeNull();
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
            form({ site_id: "a", label: "A", wp_base_url: "https://a.com" }),
        );
        expect(input.enabled).toBe(false);
        expect(input.wp_sync_enabled).toBe(false);
    });

    test("reads a present checkbox as true", () => {
        const { input } = formToSiteInput(
            form({
                site_id: "a",
                label: "A",
                wp_base_url: "https://a.com",
                enabled: "on",
                wp_sync_enabled: "on",
            }),
        );
        expect(input.enabled).toBe(true);
        expect(input.wp_sync_enabled).toBe(true);
    });

    test("trims, and maps blank optional fields to null", () => {
        const { input } = formToSiteInput(
            form({
                site_id: "  a  ",
                label: "  A  ",
                wp_base_url: "  https://a.com  ",
                wp_admin_url: "",
            }),
        );
        expect(input.site_id).toBe("a");
        expect(input.label).toBe("A");
        expect(input.wp_base_url).toBe("https://a.com");
        expect(input.wp_admin_url).toBeNull();
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
        expect(values.wp_sync_enabled).toBeUndefined();
    });
});
