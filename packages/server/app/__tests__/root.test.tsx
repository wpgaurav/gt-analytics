// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, test, vitest, vi } from "vitest";
import "vitest-dom/extend-expect";
import { render, waitFor, screen, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import Root, { Layout, links } from "../root";
import * as auth from "~/lib/auth";

vi.mock("~/lib/auth", async () => {
    const actual = await vi.importActual("~/lib/auth");
    return {
        ...actual,
        isAuthEnabled: vi.fn().mockReturnValue(true),
    };
});

function stubLoader(overrides: Record<string, unknown> = {}) {
    return function loader() {
        return {
            version: {
                name: "ABC123",
                url: null,
            },
            origin: "http://example.com",
            url: "http://example.com/path",
            user: { authenticated: false },
            isAuthEnabled: true,
            presets: [],
            siteId: null,
            ...overrides,
        };
    };
}

describe("Root", () => {
    beforeAll(() => {
        // Something in the router calls scrollTo; without a stub jsdom warns.
        window.scrollTo = vitest.fn(() => {});
    });

    afterEach(() => {
        cleanup();
        vitest.clearAllMocks();
    });

    test("renders the brand and the sidebar navigation", async () => {
        const RemixStub = createRoutesStub([
            {
                path: "/",
                Component: Root,
                loader: stubLoader({ user: { authenticated: true } }),
            },
        ]);

        render(<RemixStub />);

        await waitFor(() => screen.getByText("Dashboard"));
        // "GT Analytics" appears in both the nav brand and the footer, so
        // match the brand by its class rather than by text.
        expect(document.querySelector(".nav-brand")).toHaveTextContent(
            "GT Analytics",
        );
        // Navigation lives in the sidebar now, not the top bar.
        expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute(
            "href",
            "/dashboard",
        );
        expect(screen.getByText("Real-time").closest("a")).toHaveAttribute(
            "href",
            "/realtime",
        );
        expect(screen.getByText("Sites").closest("a")).toHaveAttribute(
            "href",
            "/admin/sites",
        );
        expect(document.querySelector(".sidebar")).toBeInTheDocument();
    });

    test("shows the deployed version", async () => {
        const RemixStub = createRoutesStub([
            { path: "/", Component: Root, loader: stubLoader() },
        ]);

        render(<RemixStub />);
        await waitFor(() => screen.getByText("ABC123"));
        expect(screen.getByText("ABC123")).toBeInTheDocument();
    });

    test("uses a single-column shell when signed out", async () => {
        const RemixStub = createRoutesStub([
            { path: "/", Component: Root, loader: stubLoader() },
        ]);

        render(<RemixStub />);
        await waitFor(() => screen.getByText("ABC123"));

        expect(document.querySelector(".app-shell")).toHaveClass("app-shell--auth");
        expect(document.querySelector(".app-main")).toHaveClass("app-main--auth");
        expect(document.querySelector(".sidebar")).not.toBeInTheDocument();
    });

    test("renders a log out link when the user is authenticated", async () => {
        vi.mocked(auth.isAuthEnabled).mockReturnValue(true);

        const RemixStub = createRoutesStub([
            {
                path: "/",
                Component: Root,
                loader: stubLoader({
                    user: { authenticated: true },
                    isAuthEnabled: true,
                }),
            },
        ]);

        render(<RemixStub />);

        await waitFor(() => screen.getByText("ABC123"));
        const logout = screen.getByText("Log out");
        expect(logout.closest("a")).toHaveAttribute("href", "/logout");
    });

    test("hides the log out link when auth is disabled", async () => {
        const RemixStub = createRoutesStub([
            {
                path: "/",
                Component: Root,
                loader: stubLoader({
                    user: { authenticated: true },
                    isAuthEnabled: false,
                }),
            },
        ]);

        render(<RemixStub />);

        await waitFor(() => screen.getByText("ABC123"));
        expect(screen.queryByText("Log out")).not.toBeInTheDocument();
    });
});

describe("links", () => {
    test("loads the Core Forms Design System and its extension layer", () => {
        const hrefs = links().map((link) => (link as { href: string }).href);

        expect(hrefs).toContain("/design-system/core-forms.css");
        expect(hrefs).toContain("/design-system/core-forms-dashboard.css");
    });

    test("preloads the Inter variable font", () => {
        // Without the preload the first paint falls back to system sans and
        // visibly reflows once Inter arrives.
        const preload = links().find(
            (link) => (link as { rel: string }).rel === "preload",
        ) as Record<string, string> | undefined;

        expect(preload).toBeDefined();
        expect(preload?.href).toBe("/design-system/fonts/inter-vf-latin.woff2");
        expect(preload?.as).toBe("font");
        // A font preload without crossorigin is fetched twice by the browser.
        expect(preload?.crossOrigin).toBe("anonymous");
    });
});

describe("Layout", () => {
    beforeAll(() => {
        window.scrollTo = vitest.fn(() => {});
    });

    afterEach(() => {
        cleanup();
        vitest.clearAllMocks();
    });

    test("renders the viewport meta tag", async () => {
        const RemixStub = createRoutesStub([
            {
                path: "/",
                // @ts-expect-error Layout renders <html>, which the stub types
                // do not model.
                Component: Layout,
            },
        ]);

        // Note: this renders an <html> element into a <div>, which warns.
        await waitFor(() => render(<RemixStub />));

        expect(document.querySelector('meta[name="viewport"]')).toHaveAttribute(
            "content",
            "width=device-width, initial-scale=1",
        );
    });

    test("keeps the dashboard out of search indexes", async () => {
        const RemixStub = createRoutesStub([
            {
                path: "/",
                // @ts-expect-error see above
                Component: Layout,
            },
        ]);

        await waitFor(() => render(<RemixStub />));

        expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
            "content",
            "noindex",
        );
    });

    test("renders a skip link as the first focusable element", async () => {
        const RemixStub = createRoutesStub([
            {
                path: "/",
                // @ts-expect-error see above
                Component: Layout,
            },
        ]);

        await waitFor(() => render(<RemixStub />));

        const skip = document.querySelector('a[href="#main"]');
        expect(skip).toBeInTheDocument();
        expect(skip).toHaveClass("visually-hidden");
    });
});
