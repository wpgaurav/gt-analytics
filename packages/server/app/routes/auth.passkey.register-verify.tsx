import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { ActionFunctionArgs } from "react-router";
import { verifyRegistration } from "~/accounts/passkeys";
import { requireAuth } from "~/lib/auth";

export async function action({ request, context }: ActionFunctionArgs) {
    await requireAuth(request, context.cloudflare.env);
    try {
        const body = await request.json<{ response: RegistrationResponseJSON; name?: string }>();
        return Response.json(await verifyRegistration(
            context.cloudflare.env.SITES_DB,
            request,
            body.response,
            body.name || "Passkey",
        ), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Passkey failed" }, { status: 400 });
    }
}
