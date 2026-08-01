import { useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";

import { CodeBlock } from "~/components/InstallSnippet";
import { requireAuth } from "~/lib/auth";
import { listSites, type Site } from "~/sites/sites";

export async function loader({ context, request }: LoaderFunctionArgs) {
    const user = await requireAuth(request, context.cloudflare.env);

    return {
        sites: await listSites(context.cloudflare.env.SITES_DB, user.accountId!),
        origin: new URL(request.url).origin,
    };
}

export default function Settings() {
    const { sites, origin } = useLoaderData<typeof loader>();
    const [siteId, setSiteId] = useState(sites[0]?.site_id || "your-site-id");

    const snippet = `<!-- GT Analytics -->
<script>
  window.gta = window.gta || function () {
    (window.gta.q = window.gta.q || []).push(arguments);
  };
</script>
<script
  id="counterscale-script"
  src="${origin}/tracker.js"
  data-site-id="${siteId}"
  defer
></script>`;

    const conversionExample = `<!-- A conversion with a value -->
<script>
  gta('conversion', 'purchase', {
    value: 4900,
    currency: 'INR',
    label: 'annual-plan'
  });
</script>`;

    const eventExample = `// A plain event, no monetary value
gta('event', 'download', { label: 'pricing-pdf' });

// On a form submit. The beacon survives the page unloading,
// so this is safe to fire immediately before navigation.
document.querySelector('#signup')?.addEventListener('submit', function () {
  gta('conversion', 'signup');
});

// On an outbound or affiliate click
document.querySelectorAll('a[href^="/go/"]').forEach(function (link) {
  link.addEventListener('click', function () {
    gta('conversion', 'affiliate-click', { label: link.pathname });
  });
});`;

    const spaExample = `// Single-page apps: pushState and popState are tracked automatically.
// Call this only if you route without touching the History API.
window.counterscale.trackPageview();`;

    return (
        <>
            <header className="app-head">
                <div>
                    <p className="kicker">
                        <Link to="/admin/sites">Sites</Link>
                    </p>
                    <h1>Install &amp; tracking</h1>
                    <p>
                        The code to add to a site, and how to record your own
                        conversions.
                    </p>
                </div>
            </header>

            {sites.length > 1 && (
                <div className="toolbar">
                    <label className="visually-hidden" htmlFor="snippet-site">
                        Site
                    </label>
                    <select
                        id="snippet-site"
                        className="select"
                        value={siteId}
                        onChange={(e) => setSiteId(e.target.value)}
                    >
                        {sites.map((site: Site) => (
                            <option key={site.site_id} value={site.site_id}>
                                {site.label} ({site.site_id})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <section className="card">
                <div className="card-head">
                    <h2>1. Tracking snippet</h2>
                </div>
                <div className="card-body stack-md">
                    <p className="muted">
                        Paste this once into the site&rsquo;s{" "}
                        <code>&lt;head&gt;</code>. It records pageviews
                        automatically, including <code>pushState</code>{" "}
                        navigation in single-page apps.
                    </p>
                    <CodeBlock code={snippet} label="HTML" />
                    <p className="field-hint">
                        The first <code>&lt;script&gt;</code> is a four-line
                        stub. It buffers any <code>gta()</code> calls that run
                        before the tracker finishes loading, so a conversion
                        that fires early is queued instead of thrown away. The
                        tracker drains that queue on load.
                    </p>
                </div>
            </section>

            <section className="card">
                <div className="card-head">
                    <h2>2. Conversions</h2>
                </div>
                <div className="card-body stack-md">
                    <p className="muted">
                        A conversion is any action worth counting: a signup, a
                        purchase, an affiliate click. Give it a short, stable
                        name — the name becomes the row label in reports, so
                        renaming it later splits the history in two.
                    </p>
                    <CodeBlock code={conversionExample} label="HTML" />
                    <CodeBlock code={eventExample} label="JavaScript" />

                    <div className="table-wrap">
                        <table className="data-table data-table--dense">
                            <thead>
                                <tr>
                                    <th className="col-main">Option</th>
                                    <th>Meaning</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="col-main mono">value</td>
                                    <td>
                                        A number, e.g. an order total. Summed in
                                        reports. Non-numeric values are recorded
                                        as zero rather than breaking the sum.
                                    </td>
                                </tr>
                                <tr>
                                    <td className="col-main mono">currency</td>
                                    <td>
                                        ISO code such as <code>INR</code> or{" "}
                                        <code>USD</code>. Only meaningful
                                        alongside a value.
                                    </td>
                                </tr>
                                <tr>
                                    <td className="col-main mono">label</td>
                                    <td>
                                        One free-form string, e.g. a plan name
                                        or form id. Keep it low-cardinality; it
                                        is a grouping key, not a note field.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <p className="field-hint">
                        Events are sent with <code>navigator.sendBeacon</code>,
                        which survives the page unloading. That makes it safe to
                        fire one immediately before a redirect or form
                        submission. If the tracker has not loaded,{" "}
                        <code>gta()</code> does nothing rather than throwing —
                        analytics must never break a checkout.
                    </p>
                </div>
            </section>

            <section className="card">
                <div className="card-head">
                    <h2>3. Script options</h2>
                </div>
                <div className="card-body">
                    <div className="table-wrap">
                        <table className="data-table data-table--dense">
                            <thead>
                                <tr>
                                    <th className="col-main">Attribute</th>
                                    <th>Effect</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="col-main mono">
                                        data-site-id
                                    </td>
                                    <td>
                                        Required. Must match the site ID
                                        exactly, or hits are recorded under an
                                        unknown site.
                                    </td>
                                </tr>
                                <tr>
                                    <td className="col-main mono">
                                        data-report-localhost
                                    </td>
                                    <td>
                                        Records hits from localhost too. Off by
                                        default so local development does not
                                        pollute real numbers.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <section className="card">
                <div className="card-head">
                    <h2>4. Manual pageviews</h2>
                </div>
                <div className="card-body stack-md">
                    <p className="muted">
                        Rarely needed. History-based routing is instrumented
                        automatically.
                    </p>
                    <CodeBlock code={spaExample} label="JavaScript" />
                </div>
            </section>

            <section className="card">
                <div className="card-head">
                    <h2>What gets collected</h2>
                </div>
                <div className="card-body">
                    <p className="muted">
                        Pageviews carry the path, host, referrer, UTM
                        parameters, country, and a coarse browser and device
                        name. Visits are counted with a rotating cache header
                        rather than a cookie, and first-touch attribution is
                        kept in <code>sessionStorage</code>, which is per-tab
                        and cleared when the tab closes. Ad-platform click IDs
                        are recorded by <em>name</em> only —{" "}
                        <code>gclid</code>, not its value — because the value
                        identifies a single click. No cookies, no cross-session
                        identifier, no personal data.
                    </p>
                </div>
            </section>
        </>
    );
}
