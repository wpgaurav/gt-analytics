/// <reference types="vite/client" />
import { LoaderFunctionArgs, type LinksFunction } from "react-router";

import {
    Links,
    Meta,
    NavLink,
    Outlet,
    Scripts,
    ScrollRestoration,
    useLoaderData,
} from "react-router";
import { getUser, isAuthEnabled } from "~/lib/auth";

/**
 * The Core Forms Design System is served as static assets rather than imported
 * through Vite, because its four @font-face rules use relative `./fonts/` URLs
 * that resolve against the stylesheet's own location. Keeping the CSS and the
 * fonts directory as deployed siblings means those paths work untouched.
 */
export const links: LinksFunction = () => [
    {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/design-system/fonts/inter-vf-latin.woff2",
        crossOrigin: "anonymous",
    },
    { rel: "stylesheet", href: "/design-system/core-forms.css" },
    { rel: "stylesheet", href: "/design-system/core-forms-dashboard.css" },
];

/**
 * Builds a link to the commit or release a deployment came from.
 *
 * This fork's own repository is private, so a SHA cannot be linked to a public
 * commit page. Semver versions still point at upstream Counterscale releases,
 * which is where the tag actually means something.
 */
function getVersionMeta(version: string | null | undefined): {
    url: string | null;
    name: string | null;
} {
    if (!version) return { url: null, name: null };

    const isSemver = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version);

    if (isSemver) {
        return {
            url: `https://github.com/benvinegar/counterscale/releases/tag/v${version}`,
            name: version,
        };
    }
    return { url: null, name: version.slice(0, 7) };
}

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
    // specified during deploy via wrangler --var VERSION:value
    const version = context.cloudflare?.env?.VERSION;
    const user = await getUser(request, context.cloudflare.env);

    return {
        version: {
            ...getVersionMeta(version),
        },
        origin: new URL(request.url).origin,
        url: request.url,
        user,
        isAuthEnabled: isAuthEnabled(context.cloudflare.env),
    };
};

export const Layout = ({ children = [] }: { children: React.ReactNode }) => {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <link rel="icon" type="image/x-icon" href="/favicon.png" />
                <meta name="robots" content="noindex" />
                <title>GT Analytics</title>
                <Meta />
                <Links />
            </head>
            <body>
                <a href="#main" className="visually-hidden">
                    Skip to main content
                </a>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
};

export default function App() {
    const data = useLoaderData<typeof loader>();
    const showLogout = data?.user?.authenticated && data?.isAuthEnabled;

    return (
        <>
            <nav className="nav">
                <div className="container nav-inner">
                    <a className="nav-brand" href="/dashboard">
                        <span>GT Analytics</span>
                    </a>
                    <div className="nav-links">
                        <NavLink
                            to="/dashboard"
                            className={({ isActive }) =>
                                isActive ? "is-active" : undefined
                            }
                        >
                            Dashboard
                        </NavLink>
                        <NavLink
                            to="/admin/sites"
                            className={({ isActive }) =>
                                isActive ? "is-active" : undefined
                            }
                        >
                            Sites
                        </NavLink>
                    </div>
                    <div className="nav-cta">
                        {showLogout && (
                            <a className="nav-account" href="/logout">
                                Log out
                            </a>
                        )}
                    </div>
                </div>
            </nav>

            <main id="main" role="main" className="container app-main">
                <Outlet />
            </main>

            <footer className="footer">
                <div className="container">
                    <div className="footer-bottom">
                        <span>GT Analytics</span>
                        <span>
                            {data?.version?.name ? (
                                data.version.url ? (
                                    <a
                                        href={data.version.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {data.version.name}
                                    </a>
                                ) : (
                                    <span className="mono">
                                        {data.version.name}
                                    </span>
                                )
                            ) : (
                                "unknown version"
                            )}
                        </span>
                    </div>
                </div>
            </footer>
        </>
    );
}
