import { Client } from "./lib/client";
import type { ClientOpts } from "./lib/client";

import { trackPageview as _trackPageview } from "./lib/track";
import type { TrackPageviewOpts } from "./lib/track";
import { trackEvent as _trackEvent } from "./lib/events";
import type { TrackEventOpts } from "./lib/events";

const GLOBALS = {
    client: undefined as Client | undefined,
};

export function init(opts: ClientOpts) {
    if (GLOBALS.client) {
        return;
    }
    GLOBALS.client = new Client(opts);
}

export function isInitialized() {
    return Boolean(GLOBALS.client);
}

export function getInitializedClient(): typeof GLOBALS["client"] {
    return GLOBALS.client 
}

export function trackPageview(opts?: TrackPageviewOpts) {
    if (!GLOBALS.client) {
        throw new Error(
            "You must call Counterscale.initialize() before calling Counterscale.trackPageview().",
        );
    }
    _trackPageview(GLOBALS.client, opts);
}

export function cleanup() {
    if (!GLOBALS.client) {
        return; // no-op if not already initialized (TODO: warn?)
    }
    GLOBALS.client.cleanup();
    GLOBALS.client = undefined;
}

/**
 * Records a custom event.
 *
 * Silently does nothing when the tracker has not been initialised, unlike
 * trackPageview which throws. A missed analytics event must never be able to
 * break a checkout or a signup flow.
 */
export function trackEvent(name: string, opts?: TrackEventOpts) {
    if (!GLOBALS.client) return;
    _trackEvent(GLOBALS.client, name, "event", opts);
}

/** Records a conversion: an event that counts toward a goal. */
export function trackConversion(name: string, opts?: TrackEventOpts) {
    if (!GLOBALS.client) return;
    _trackEvent(GLOBALS.client, name, "conversion", opts);
}

export type { TrackEventOpts };
