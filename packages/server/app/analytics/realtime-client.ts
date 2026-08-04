/**
 * Feeds hits to the real-time Durable Object.
 *
 * Every call here is best-effort and fire-and-forget. Real-time is a
 * convenience view; if the object is unreachable the pixel must still return
 * and Analytics Engine must still receive the hit, because that is the system
 * of record.
 */

import type { RealtimeHit } from "../../workers/realtime";
import { hmacSha256 } from "../lib/crypto";

/**
 * Derives a site-scoped, daily pseudonymous visitor key.
 *
 * Cookieless by construction: an HMAC of the UTC day, site, client IP and user
 * agent. The secret never leaves the Worker, and neither the raw IP nor user
 * agent can be recovered from the result. Including the site and day prevents
 * the key from being used to correlate a visitor across sites or UTC days.
 *
 * The same key is used by the real-time Durable Object and as Analytics
 * Engine's index. This lets reports count distinct daily visitors accurately,
 * including for individual pages and other dimensions, without storing a
 * persistent identifier.
 */
export async function visitorKey(
    siteId: string,
    request: Request,
    salt: string,
): Promise<string> {
    const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for") ||
        "";
    const ua = request.headers.get("user-agent") || "";
    const day = new Date().toISOString().slice(0, 10); // rotates daily, UTC

    return hmacSha256(salt, `${day}|${siteId}|${ip}|${ua}`);
}

/** Sends a hit to the site's real-time object. Never throws. */
export async function pushRealtimeHit(
    namespace: DurableObjectNamespace | undefined,
    hit: RealtimeHit,
): Promise<void> {
    if (!namespace || !hit.siteId) return;

    try {
        const id = namespace.idFromName(hit.siteId);
        await namespace.get(id).fetch("https://realtime/hit", {
            method: "POST",
            body: JSON.stringify(hit),
            headers: { "content-type": "application/json" },
        });
    } catch (error) {
        console.error("realtime push failed", error);
    }
}

/** Reads a site's current snapshot. Returns null when unavailable. */
export async function readRealtimeSnapshot(
    namespace: DurableObjectNamespace | undefined,
    siteId: string,
): Promise<unknown | null> {
    if (!namespace || !siteId) return null;

    try {
        const id = namespace.idFromName(siteId);
        const response = await namespace
            .get(id)
            .fetch("https://realtime/snapshot");
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error("realtime snapshot failed", error);
        return null;
    }
}
