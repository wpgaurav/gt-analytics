import { useState } from "react";

export interface InstallSnippetProps {
    /** The collector origin, e.g. https://stats.gauravtiwari.org */
    origin: string;
    siteId: string;
}

/**
 * The tracking snippet for one site, ready to paste.
 *
 * Rendered from the live request origin rather than a hardcoded host, so a
 * preview deployment hands out its own URL instead of pointing installs at
 * production.
 */
export default function InstallSnippet({ origin, siteId }: InstallSnippetProps) {
    const snippet = `<script\n    id="counterscale-script"\n    src="${origin}/tracker.js"\n    data-site-id="${siteId}"\n    defer\n></script>`;

    return (
        <div className="stack-md">
            <CodeBlock
                label="Paste this once, in the site's <head>"
                code={snippet}
            />
            <p className="field-hint">
                Placing it in <code>&lt;head&gt;</code> with{" "}
                <code>defer</code> means the first pageview is recorded even if
                the visitor leaves before the page finishes loading. Some
                optimisation plugins rewrite scripts placed before{" "}
                <code>&lt;/body&gt;</code>, which is another reason to keep it
                in the head.
            </p>
        </div>
    );
}

export function CodeBlock({ label, code }: { label?: string; code: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard access can be blocked; the code is selectable anyway.
        }
    }

    return (
        <div className="codeblock">
            <div className="codeblock__head">
                <span className="codeblock__label">{label}</span>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={copy}
                >
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <pre className="codeblock__code">
                <code>{code}</code>
            </pre>
        </div>
    );
}
