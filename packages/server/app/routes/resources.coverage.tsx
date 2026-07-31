import type { LoaderFunctionArgs } from "react-router";
import dayjs from "dayjs";

import { requireApiAuth } from "~/lib/api-auth";
import { AE_RETENTION_DAYS } from "~/analytics/range";

/**
 * How far back the data actually goes.
 *
 * The picker asks this instead of offering a fixed span, because the honest
 * answer changes over time: Analytics Engine's window slides forward daily,
 * and the archive only reaches back as far as it has been running or as far as
 * imported history goes. Offering five years when three months exist just
 * produces empty reports that look like lost data.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
    await requireApiAuth(request, context.cloudflare.env);

    const today = dayjs().format("YYYY-MM-DD");
    const liveEarliest = dayjs()
        .subtract(AE_RETENTION_DAYS, "day")
        .format("YYYY-MM-DD");

    const archive = await context.history.bounds();

    // The archive can start before Analytics Engine's window, and there can be
    // a gap between the two if archiving was ever interrupted. earliest is the
    // oldest day either store can answer.
    const earliest =
        archive.earliest && archive.earliest < liveEarliest
            ? archive.earliest
            : liveEarliest;

    return Response.json({
        earliest,
        latest: today,
        live: { earliest: liveEarliest, latest: today },
        archive: {
            earliest: archive.earliest,
            latest: archive.latest,
            days: archive.days,
            enabled: context.history.hasArchive,
        },
    });
}
