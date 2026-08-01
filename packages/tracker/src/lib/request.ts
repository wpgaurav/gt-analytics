import type { CollectRequestParams, CacheResponse } from "../shared/types";
import { buildCollectUrl } from "../shared/request";

const REQUEST_TIMEOUT = 1000;
const HIT_STATE_PREFIX = "_cs_hits_";
const pendingImages = new Set<HTMLImageElement>();

/**
 * Checks the cache status by calling the /cache endpoint
 * @param baseUrl The base URL for the API
 * @param siteId The site ID to include in the cache URL
 * @returns A promise that resolves to the cache status
 */
export function checkCacheStatus(
    baseUrl: string,
    siteId: string,
): Promise<CacheResponse> {
    return new Promise((resolve) => {
        // Default fallback response for any error case
        const fallbackResponse: CacheResponse = {
            ht: 1, // Assume first hit (new visit)
        };

        // Replace the final /collect path segment with /cache and add site ID as a query parameter
        // This ensures we don't accidentally replace "collect" if it appears in the hostname or elsewhere
        const cacheUrl = `${baseUrl.replace(/\/collect$/, "/cache")}?sid=${encodeURIComponent(siteId)}`;
        const xhr = new XMLHttpRequest();

        xhr.open("GET", cacheUrl, true);
        xhr.timeout = REQUEST_TIMEOUT;
        // needs to be text/plain or triggers preflight
        xhr.setRequestHeader("Content-Type", "text/plain");

        xhr.onload = function () {
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(
                        xhr.responseText,
                    ) as CacheResponse;
                    resolve(response);
                } catch {
                    // If parsing fails, use fallback
                    resolve(fallbackResponse);
                }
            } else {
                // If request fails, use fallback
                resolve(fallbackResponse);
            }
        };

        // Use fallback for error cases
        xhr.onerror = () => resolve(fallbackResponse);
        xhr.ontimeout = () => resolve(fallbackResponse);

        xhr.send();
    });
}

/**
 * Makes a request to the collect endpoint
 * @param url The collect endpoint URL
 * @param params The parameters to send
 */
export function makeRequest(url: string, params: CollectRequestParams) {
    const fullUrl = buildCollectUrl(url, params); // Don't filter empty strings for browser compatibility

    sendBeaconRequest(fullUrl);
}

/** Sends a teardown-safe request without delaying navigation. */
export function sendBeaconRequest(fullUrl: string) {
    try {
        if (navigator.sendBeacon && navigator.sendBeacon(fullUrl)) return;
    } catch {
        // Fall through to the image request below.
    }

    const image = new Image();
    const cleanup = () => pendingImages.delete(image);
    image.onload = cleanup;
    image.onerror = cleanup;
    pendingImages.add(image);
    image.src = fullUrl;
}

/**
 * Synchronous cookieless daily-visitor state.
 *
 * Stores only a UTC date plus a capped hit count on the publisher's origin:
 * no random identifier, no cookie, and nothing usable across sites.
 */
export function nextHitType(siteId: string): string {
    const day = new Date().toISOString().slice(0, 10);
    const key = HIT_STATE_PREFIX + siteId;
    const storage = safeStorage();

    if (!storage) return "1";

    let previous: { day?: string; hits?: number } = {};
    try {
        previous = JSON.parse(storage.getItem(key) || "{}");
    } catch {
        previous = {};
    }

    const hits =
        previous.day === day
            ? Math.min(3, Math.max(0, Number(previous.hits) || 0) + 1)
            : 1;

    try {
        storage.setItem(key, JSON.stringify({ day, hits }));
    } catch {
        // The request is still useful even when persistence is denied.
    }

    return String(hits);
}

function safeStorage(): Storage | null {
    for (const name of ["localStorage", "sessionStorage"] as const) {
        try {
            // Accessing the property itself can throw in hardened privacy
            // modes, so it belongs inside the try block too.
            const storage = window[name];
            const probe = "__cs_hit_probe";
            storage.setItem(probe, "1");
            storage.removeItem(probe);
            return storage;
        } catch {
            // Try the next first-party storage mechanism.
        }
    }

    return null;
}
