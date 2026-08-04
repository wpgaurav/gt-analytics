export type ColumnMappingToType<
    T extends (typeof ColumnMappings)[keyof typeof ColumnMappings],
> = T extends `blob${number}`
    ? string
    : T extends `double${number}`
      ? number
      : never;

/**
 * This maps logical column names to the actual column names in the data store.
 */

export const ColumnMappings = {
    /**
     * blobs
     */
    host: "blob1",
    userAgent: "blob2",
    path: "blob3",
    country: "blob4",
    referrer: "blob5",
    browserName: "blob6",
    deviceModel: "blob7",
    siteId: "blob8",
    browserVersion: "blob9",
    deviceType: "blob10",
    utmSource: "blob11",
    utmMedium: "blob12",
    utmCampaign: "blob13",
    utmTerm: "blob14",
    utmContent: "blob15",

    // Referral attribution, derived at collection time from the referrer,
    // the UTM parameters and any ad-platform click ID. See analytics/referrer.
    //
    // referrerHost is the normalised source hostname (www stripped, self
    // referrals removed), so a source does not split across rows the way the
    // raw referrer in blob5 does.
    referrerHost: "blob16",
    // direct | search | ai | social | email | paid | referral | internal
    channel: "blob17",
    // Which click ID was on the landing URL, e.g. gclid. Names only -- the
    // values identify an individual click and are not worth storing.
    clickId: "blob18",
    // Path the session started on, carried on every hit in that session.
    // Bounce is +1 on the first pageview and -1 on the second -- usually a
    // different path -- so a per-page rate is only correct when both markers
    // are attributed to the same landing page.
    entryPath: "blob19",
    // Site-scoped HMAC of UTC day + network/browser signals. It rotates daily,
    // contains no raw personal data, and is also the Analytics Engine index so
    // COUNT(DISTINCT index1) remains accurate when sampling is applied.
    visitorKey: "blob20",

    /**
     * doubles
     */

    // this record is a new visitor (every 24h)
    newVisitor: "double1",

    // this record is a new session (resets after 30m inactivity)
    newSession: "double2",

    // this record is the bounce value
    bounce: "double3",
} as const;
