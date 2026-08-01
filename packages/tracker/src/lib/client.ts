import { autoTrackPageviews } from "./track";
import { trackEngagement } from "./engagement";
import { trackPresence } from "./presence";
import type { BaseClientConfig } from "../shared/types";

export type ClientOpts = BaseClientConfig & {
    autoTrackPageviews?: boolean;
};

export class Client {
    siteId: string;
    reporterUrl: string;
    reportOnLocalhost = false;

    _cleanupAutoTrackPageviews?: () => void;
    _cleanupEngagement?: () => void;
    _cleanupPresence?: () => void;

    constructor(opts: ClientOpts) {
        this.siteId = opts.siteId;
        this.reporterUrl = opts.reporterUrl;

        if (opts.reportOnLocalhost) {
            this.reportOnLocalhost = opts.reportOnLocalhost;
        }

        // default to true
        if (opts.autoTrackPageviews === undefined || opts.autoTrackPageviews) {
            // Use setTimeout to ensure this runs after the constructor
            // This helps with testing and avoids issues with async trackPageview
            setTimeout(() => {
                this._cleanupAutoTrackPageviews = autoTrackPageviews(this);
                this._cleanupEngagement = trackEngagement(this);
                this._cleanupPresence = trackPresence(this);
            }, 0);
        }
    }

    cleanup() {
        if (this._cleanupAutoTrackPageviews) {
            this._cleanupAutoTrackPageviews();
        }
        if (this._cleanupEngagement) {
            this._cleanupEngagement();
        }
        if (this._cleanupPresence) {
            this._cleanupPresence();
        }
    }
}
