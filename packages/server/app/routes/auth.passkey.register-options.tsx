import type { LoaderFunctionArgs } from "react-router";
import { registrationOptions } from "~/accounts/passkeys";
import { requireAuth } from "~/lib/auth";

export async function loader({ request, context }: LoaderFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);
    if (!user.userId) throw new Response("Passkeys require an authenticated account", { status: 400 });
    const result = await registrationOptions(context.cloudflare.env.SITES_DB, request, user.userId);
    return Response.json(result.options, {
        headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" },
    });
}
