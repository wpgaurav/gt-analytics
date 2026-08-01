import type { Client } from "./client";
import { sendBeaconRequest } from "./request";
import { getHostnameAndPath } from "../shared/utils";

/** A visible reader refreshes their presence twice a minute. */
const HEARTBEAT_MS = 30_000;

/**
 * Keeps Real-time honest for long reads.
 *
 * Heartbeats are sent only while the tab is visible and never enter Analytics
 * Engine, so they affect neither pageviews nor historical visitors.
 */
export function trackPresence(client: Client) {
    const send = () => {
        if (document.visibilityState !== "visible") return;

        const { hostname, path } = getHostnameAndPath(
            window.location.pathname + window.location.search || "/",
            true,
        );
        const search = new URLSearchParams({
            sid: client.siteId,
            h: hostname,
            p: path,
        });
        sendBeaconRequest(`${client.reporterUrl}/presence?${search}`);
    };

    const timer = window.setInterval(send, HEARTBEAT_MS);
    const onVisibility = () => {
        if (document.visibilityState === "visible") send();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisibility);
    };
}
