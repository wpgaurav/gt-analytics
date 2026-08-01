// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import "vitest-dom/extend-expect";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import Signup, { action } from "../signup";

describe("invite signup route", () => {
    afterEach(cleanup);

    test("renders account creation only for a valid invitation", async () => {
        const Router = createRoutesStub([{
            path: "/signup",
            Component: Signup,
            loader: () => ({
                token: "invite-token",
                invitation: {
                    accountName: "Example Analytics",
                    accountSlug: "example",
                    accountTimezone: "UTC",
                    expiresAt: Math.floor(Date.now() / 1000) + 3600,
                },
            }),
        }]);

        render(<Router initialEntries={["/signup?token=invite-token"]} />);
        await waitFor(() => screen.getByRole("heading", { name: "Create your account" }));
        expect(screen.getByText(/invited to manage Example Analytics/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    });

    test("does not expose public signup without a valid invitation", async () => {
        const Router = createRoutesStub([{
            path: "/signup",
            Component: Signup,
            loader: () => ({ token: "", invitation: null }),
        }]);

        render(<Router initialEntries={["/signup"]} />);
        await waitFor(() => screen.getByRole("heading", { name: "Invitation unavailable" }));
        expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Return to sign in" })).toHaveAttribute("href", "/");
    });

    test("rejects mismatched passwords before touching the database", async () => {
        const form = new FormData();
        form.set("token", "invite-token");
        form.set("username", "new.owner");
        form.set("display_name", "New Owner");
        form.set("password", "a-strong-password");
        form.set("confirm_password", "different-password");
        const request = new Request("https://example.com/signup?token=invite-token", {
            method: "POST",
            body: form,
        });

        const result = await action({
            request,
            params: {},
            context: { cloudflare: { env: {} } },
        });

        expect(result).toEqual({ error: "Passwords do not match." });
    });
});
