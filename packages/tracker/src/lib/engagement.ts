import type { Client } from "./client";
import { trackEvent } from "./events";

/**
 * Time actually spent looking at a page.
 *
 * Counts only while the tab is visible, so a page left open in a background
 * tab overnight does not report a twelve-hour view. Sent once, when the page
 * is first hidden or unloaded, via sendBeacon -- the only transport that
 * survives navigation.
 */
export function trackEngagement(client: Client) {
    let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    let engagedMs = 0;
    let sent = false;

    const accumulate = () => {
        if (visibleSince) {
            engagedMs += Date.now() - visibleSince;
            visibleSince = 0;
        }
    };

    const flush = () => {
        if (sent) return;
        accumulate();

        const seconds = Math.round(engagedMs / 1000);
        // A zero-second view carries no information and would drag every
        // average down, so it is not worth a request.
        if (seconds < 1) return;

        sent = true;
        trackEvent(client, "duration", "event", { value: seconds });
    };

    const onVisibility = () => {
        if (document.visibilityState === "visible") {
            if (!visibleSince) visibleSince = Date.now();
        } else {
            // Hiding is the last reliable moment on mobile: pagehide and
            // beforeunload are not guaranteed to fire there.
            flush();
        }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", flush);
    };
}
