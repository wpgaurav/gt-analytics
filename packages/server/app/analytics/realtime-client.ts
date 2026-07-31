/**
 * Feeds hits to the real-time Durable Object.
 *
 * Every call here is best-effort and fire-and-forget. Real-time is a
 * convenience view; if the object is unreachable the pixel must still return
 * and Analytics Engine must still receive the hit, because that is the system
 * of record.
 */

import type { RealtimeHit } from "../../workers/realtime";

/**
 * Derives a pseudonymous key for "is this the same person as a moment ago".
 *
 * Cookieless by construction: a SHA-256 of the site, the client IP, the user
 * agent and a salt that rotates every UTC day, truncated to 16 hex characters.
 *
 * The result exists only inside the Durable Object's five-minute window. It is
 * never written to Analytics Engine, never persisted to storage, and cannot be
 * correlated across days because the salt has rotated. It exists solely to
 * count distinct people currently on the site.
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

    const material = `${salt}|${day}|${siteId}|${ip}|${ua}`;
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(material),
    );

    return [...new Uint8Array(digest)]
        .slice(0, 8)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
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
