import { redirect, type ActionFunctionArgs } from "react-router";

import { requireAuth } from "~/lib/auth";
import {
    createPreset,
    deletePreset,
    normalizePresetQuery,
} from "~/sites/presets";

/**
 * Create and delete saved views.
 *
 * Action-only: the sidebar posts here and is sent back where it came from, so
 * saving a view never navigates away from the report being looked at.
 */
export async function action({ context, request }: ActionFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);

    const db: D1Database = context.cloudflare.env.SITES_DB;
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "delete") {
        const id = Number(form.get("id"));
        if (Number.isFinite(id)) await deletePreset(db, user.accountId!, id);
        return backToReferrer(request);
    }

    if (intent === "create") {
        const name = String(form.get("name") || "").trim();
        const query = normalizePresetQuery(String(form.get("search") || ""));

        // A nameless preset would render as a blank row in the sidebar.
        if (name) {
            await createPreset(db, user.accountId!, name, query, iconForQuery(query));
        }
        return backToReferrer(request);
    }

    return backToReferrer(request);
}

/** Picks a sensible icon from whatever the view is filtered by. */
function iconForQuery(query: string): string {
    const params = new URLSearchParams(query);
    const channel = params.get("channel");

    switch (channel) {
        case "ai":
            return "robot";
        case "search":
            return "magnifying-glass";
        case "social":
            return "share-nodes";
        case "email":
            return "envelope";
        case "paid":
            return "rectangle-ad";
        case "referral":
            return "link";
        case "direct":
            return "house";
        default:
            break;
    }

    if (params.get("country")) return "globe";
    if (params.get("path")) return "file-lines";
    return "gauge-high";
}

function backToReferrer(request: Request) {
    const referrer = request.headers.get("Referer");
    if (referrer) {
        try {
            const url = new URL(referrer);
            // Only follow our own origin -- a Referer header is attacker
            // controllable and this is a redirect target.
            if (url.origin === new URL(request.url).origin) {
                return redirect(url.pathname + url.search);
            }
        } catch {
            // Fall through to the dashboard.
        }
    }
    return redirect("/dashboard");
}
