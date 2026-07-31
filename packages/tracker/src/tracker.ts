"use strict";

import * as Counterscale from "./index";

function findReporterScript() {
    const el = document.getElementById(
        "counterscale-script",
    ) as HTMLScriptElement;
    return el;
}

function getLegacySiteId(): string | undefined {
    // backwards compatibility layer with legacy API for setting
    // site id using inline script + global variables
    type CommandName = "set" | "trackPageview";
    type CommandArgs = string[];
    type Command = [CommandName, ...CommandArgs];

    let siteId = undefined;
    const queue = (window.counterscale && window.counterscale.q) || [];
    queue.forEach(function (cmd: Command) {
        // only interested in grabbing siteId
        if (cmd[0] === "set" && cmd[1] === "siteId") {
            siteId = cmd[2];
        }
    });

    return siteId;
}

function init() {
    const script = findReporterScript();
    const siteId = script?.getAttribute("data-site-id") || getLegacySiteId();
    const reportOnLocalhost = (script?.hasAttribute("data-report-localhost") && script?.getAttribute("data-report-localhost") !== "false") || false;

    const reporterUrl = script?.src.replace("tracker.js", "collect");

    if (!siteId || !reporterUrl) {
        return;
    }

    Counterscale.init({
        siteId,
        reportOnLocalhost,
        reporterUrl,
        autoTrackPageviews: true,
    });

    installCommandQueue();
}

/**
 * Wires up the public `gta()` command API and drains anything the install
 * snippet's stub buffered while this script was still loading.
 *
 *   gta('conversion', 'signup', { value: 49, currency: 'INR' })
 *   gta('event', 'download', { label: 'pricing-pdf' })
 */
function installCommandQueue() {
    type Command = [string, string, Record<string, unknown>?];

    const existing = window.gta;
    const queued: Command[] = (existing && existing.q) || [];

    const gta = function (...args: unknown[]) {
        const [command, name, opts] = args as Command;

        if (!command || !name) return;

        if (command === "conversion") {
            Counterscale.trackConversion(name, opts);
        } else if (command === "event") {
            Counterscale.trackEvent(name, opts);
        }
        // Unknown commands are ignored rather than thrown: a typo in a site's
        // analytics call must not break the page it is on.
    };

    window.gta = gta;

    for (const command of queued) {
        try {
            gta(...command);
        } catch {
            // One bad queued call should not stop the rest from flushing.
        }
    }
}

(function () {
    // body (and thus, script elem) might not be accessible until
    // DOMContentLoaded, so wait for that first
    if (document.body === null) {
        document.addEventListener("DOMContentLoaded", () => {
            init();
        });
        return;
    }

    init();
})();
