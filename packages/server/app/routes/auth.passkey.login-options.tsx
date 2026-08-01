import type { LoaderFunctionArgs } from "react-router";
import { authenticationOptions } from "~/accounts/passkeys";
import { isAuthEnabled } from "~/lib/auth";

export async function loader({ request, context }: LoaderFunctionArgs) {
    if (!isAuthEnabled(context.cloudflare.env)) throw new Response("Authentication disabled", { status: 404 });
    const result = await authenticationOptions(context.cloudflare.env.SITES_DB, request);
    return Response.json(result.options, {
        headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" },
    });
}
