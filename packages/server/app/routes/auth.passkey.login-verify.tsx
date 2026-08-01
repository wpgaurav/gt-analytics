import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { ActionFunctionArgs } from "react-router";
import { verifyAuthentication } from "~/accounts/passkeys";
import { createSession, createSessionCookie } from "~/lib/session";

export async function action({ request, context }: ActionFunctionArgs) {
    try {
        const response = await request.json<AuthenticationResponseJSON>();
        const user = await verifyAuthentication(context.cloudflare.env.SITES_DB, request, response);
        const token = await createSession(context.cloudflare.env.SITES_DB, user.id, user.account_id);
        return Response.json({ verified: true, redirect: "/dashboard" }, {
            headers: { "Set-Cookie": createSessionCookie(token, request), "Cache-Control": "no-store" },
        });
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Passkey failed" }, { status: 401 });
    }
}
