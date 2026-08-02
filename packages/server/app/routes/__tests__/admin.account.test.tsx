// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import "vitest-dom/extend-expect";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import AccountSettings from "../admin.account";

const future = Math.floor(Date.now() / 1000) + 3600;

function accountData(inviteUrl: string | null) {
    return {
        user: {
            authenticated: true,
            accountId: "acct_owner",
            userId: "usr_owner",
            isSystemAdmin: true,
        },
        account: { id: "acct_owner", name: "Owner", timezone: "UTC" },
        sites: [],
        apiKeys: [],
        passkeys: [],
        accounts: [],
        invitations: [{
            id: "inv_example",
            account_name: "Example Analytics",
            account_slug: "example",
            account_timezone: "UTC",
            expires_at: future,
            accepted_at: null,
            revoked_at: null,
            created_at: future - 60,
            inviteUrl,
        }],
    };
}

describe("account invitation links", () => {
    afterEach(cleanup);

    test("shows the complete active invitation link after a reload", async () => {
        const inviteUrl = "https://stats.example/signup?token=inv_example.signed-token";
        const Router = createRoutesStub([{
            path: "/admin/account",
            Component: AccountSettings,
            loader: () => accountData(inviteUrl),
        }]);

        render(<Router initialEntries={["/admin/account"]} />);
        await waitFor(() => screen.getByRole("heading", { name: "Accounts & invitations" }));
        expect(screen.getByLabelText("Full invitation link")).toHaveValue(inviteUrl);
        expect(screen.getByRole("button", { name: "Copy invitation link" })).toBeInTheDocument();
    });

    test("offers regeneration for an active legacy invitation", async () => {
        const Router = createRoutesStub([{
            path: "/admin/account",
            Component: AccountSettings,
            loader: () => accountData(null),
        }]);

        render(<Router initialEntries={["/admin/account"]} />);
        await waitFor(() => screen.getByRole("button", { name: "Generate link" }));
        expect(screen.queryByLabelText("Full invitation link")).not.toBeInTheDocument();
        expect(screen.getByText(/predates persistent links/i)).toBeInTheDocument();
    });
});
