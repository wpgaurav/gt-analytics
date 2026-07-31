import type { CollectRequestParams, UtmParams } from "./types";
import { queryParamStringify } from "./utils";

export function buildCollectRequestParams(
    siteId: string,
    hostname: string,
    path: string,
    referrer: string,
    utmParams: UtmParams = {},
    hitType?: string,
    attribution: { sessionReferrer?: string; clickId?: string } = {},
): CollectRequestParams {
    const params: CollectRequestParams = {
        p: path,
        h: hostname,
        r: referrer,
        sid: siteId,
    };

    if (hitType) {
        params.ht = hitType;
    }

    // Only send the session referrer when it adds something the immediate
    // referrer does not, to keep the pixel URL short.
    if (attribution.sessionReferrer && attribution.sessionReferrer !== referrer) {
        params.sr = attribution.sessionReferrer;
    }

    if (attribution.clickId) {
        params.ci = attribution.clickId;
    }

    Object.assign(params, utmParams);

    return params;
}

export function buildCollectUrl(
    baseUrl: string,
    params: CollectRequestParams,
    filterEmpty = false,
): string {
    return baseUrl + queryParamStringify(params, filterEmpty);
}
