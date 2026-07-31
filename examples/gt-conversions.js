/**
 * Conversion tracking for the GT sites.
 *
 * One file for all four. Every hook is feature-detected -- a site without
 * Fluent Cart simply never matches those selectors -- so there is nothing to
 * keep in step per site.
 *
 * Drop this in after the GT Analytics tracker script. It adds nothing to the
 * page's critical path: every listener is delegated from `document`, so it
 * survives Fluent Cart replacing DOM fragments, and every handler is wrapped
 * so a analytics failure can never break a checkout or a form submission.
 *
 * Events go out through `gta()`, which sends with sendBeacon -- the browser
 * completes the request even as the page is being torn down by a navigation,
 * which is exactly when most of these fire.
 *
 * What it records, and why each hook was chosen over the obvious alternative:
 *
 *   affiliate_click   /go/{slug} links. These are same-origin (GT Link Manager
 *                     301s them), so generic outbound-link tracking misses
 *                     them entirely -- they look like internal navigation.
 *   add_to_cart       [data-fluent-cart-add-to-cart-button]
 *   begin_checkout    Buy Now buttons, the modal opening, and /checkout/
 *   purchase          any URL carrying ?order_hash=, deduplicated per order
 *   lead              Core Forms 'cf-success', which the plugin dispatches on
 *                     the form element after a successful AJAX submit. Bound
 *                     rather than 'submit' because submit fires on attempts,
 *                     including ones that fail validation server-side.
 *   download          PDF and file links
 *   outbound_click    external links that are not affiliate links
 *   contact_click     mailto: and tel:
 */
(function () {
    "use strict";

    /**
     * Buffer for calls made before the tracker finishes loading.
     *
     * The tracker tag is `defer`, so it executes after this block is parsed.
     * Click handlers are fine -- nobody clicks that fast -- but the purchase
     * check below runs immediately at load, and without this it would find no
     * `gta` and be dropped. Silently: it would also have marked the order as
     * already recorded, so it could never fire again.
     *
     * The tracker drains `window.gta.q` when it initialises.
     */
    window.gta =
        window.gta ||
        function () {
            (window.gta.q = window.gta.q || []).push(arguments);
        };

    var ORIGIN = window.location.origin;

    /**
     * Forms that are not leads.
     *
     * A deny list, not an allow list: service pages get new forms regularly,
     * and the failure mode of an allow list is that a new service form
     * silently records nothing. Here a new form counts as a lead until it is
     * explicitly excluded, which is the safer direction to be wrong in.
     */
    var NON_LEAD_FORMS_BY_HOST = {
        "gauravtiwari.org": {
            1163801: "support_request", // Support request
            1093806: "contributor_pitch", // Write for Us
        },
    };

    // Scoped by host because a form ID is a WordPress post ID, and the same
    // number is a different form on a different site. An unscoped list would
    // silently demote whatever happened to share an ID elsewhere.
    var NON_LEAD_FORMS =
        NON_LEAD_FORMS_BY_HOST[window.location.hostname.replace(/^www\./, "")] ||
        {};

    /** Extensions treated as a download rather than a page. */
    var DOWNLOAD_RE = /\.(pdf|zip|epub|mobi|csv|xlsx?|docx?|pptx?|mp3|mp4|wav)(\?|#|$)/i;

    /** Nothing here may throw into the page. */
    function safe(fn) {
        return function (event) {
            try {
                fn(event);
            } catch (error) {
                if (window.console && console.debug) {
                    console.debug("conversion tracking:", error);
                }
            }
        };
    }

    function send(kind, name, opts) {
        if (typeof window.gta === "function") {
            window.gta(kind, name, opts || {});
        }
    }

    function parseUrl(href) {
        try {
            return new URL(href, ORIGIN);
        } catch (error) {
            return null;
        }
    }

    /** Once per browser session, so a refresh does not re-record. */
    function firstTimeOnly(key) {
        try {
            var storageKey = "_gta_once_" + key;
            if (window.localStorage.getItem(storageKey)) return false;
            window.localStorage.setItem(storageKey, "1");
            return true;
        } catch (error) {
            // Private mode, or storage disabled. Recording a possible
            // duplicate beats recording nothing.
            return true;
        }
    }

    // ---------------------------------------------------------------- clicks

    /**
     * One delegated listener for every kind of link.
     *
     * 'auxclick' as well as 'click' because a middle-click opens the link in a
     * background tab and is every bit as real an affiliate click, but never
     * fires 'click'.
     */
    function onClick(event) {
        // Right-click opens a context menu; nothing has been visited yet.
        if (event.type === "auxclick" && event.button !== 1) return;

        var link = event.target.closest && event.target.closest("a[href]");
        if (!link) return;

        // The admin bar is not the site.
        if (link.closest("#wpadminbar")) return;

        var href = link.getAttribute("href") || "";
        if (!href || href.charAt(0) === "#") return;

        if (href.indexOf("mailto:") === 0) {
            send("event", "contact_click", { label: "email" });
            return;
        }
        if (href.indexOf("tel:") === 0) {
            send("event", "contact_click", { label: "phone" });
            return;
        }

        var url = parseUrl(href);
        if (!url) return;

        var isInternal = url.origin === ORIGIN;

        // Affiliate links first: they are internal URLs, so any outbound check
        // would classify them as ordinary navigation and lose them.
        var affiliate = isInternal && url.pathname.match(/^\/go\/([^/]+)\/?$/);
        if (affiliate) {
            send("conversion", "affiliate_click", { label: affiliate[1] });
            return;
        }

        if (DOWNLOAD_RE.test(url.pathname)) {
            send("event", "download", {
                label: url.pathname.split("/").pop(),
            });
            return;
        }

        if (!isInternal) {
            send("event", "outbound_click", { label: url.hostname });
        }
    }

    document.addEventListener("click", safe(onClick), true);
    document.addEventListener("auxclick", safe(onClick), true);

    // ------------------------------------------------------------- commerce

    document.addEventListener(
        "click",
        safe(function (event) {
            var target = event.target.closest && event.target.closest("*");
            if (!target) return;

            var addToCart = event.target.closest(
                "[data-fluent-cart-add-to-cart-button]",
            );
            if (addToCart) {
                send("event", "add_to_cart", {
                    label:
                        addToCart.getAttribute("data-product-id") ||
                        addToCart.getAttribute("data-cart-id") ||
                        "unknown",
                });
                return;
            }

            // "Buy Now" skips the cart entirely, so it is the start of a
            // checkout rather than an add-to-cart.
            var buyNow = event.target.closest(
                "[data-fluent-cart-direct-checkout-button]",
            );
            if (buyNow) {
                send("conversion", "begin_checkout", {
                    label:
                        buyNow.getAttribute("data-cart-id") || "direct",
                });
            }
        }),
        true,
    );

    // The modal checkout never changes the URL, so a /checkout/ pageview would
    // never happen for it.
    window.addEventListener(
        "fluentCartModalCheckoutOpened",
        safe(function () {
            send("conversion", "begin_checkout", { label: "modal" });
        }),
    );

    // ------------------------------------------------------------- purchase

    /**
     * A paid order, recorded once.
     *
     * The receipt page is bookmarkable, e-mailed to the customer, and reloaded
     * by people checking their order -- so the order hash, not the pageview,
     * is what makes a purchase unique.
     *
     * Value is deliberately absent: the amount is rendered as formatted
     * currency text, and parsing "$49.00" back into a number guesses at
     * locale, symbol and thousands separators. See the PHP snippet alongside
     * this file for exact revenue.
     */
    (function trackPurchase() {
        try {
            // Keyed on the order parameter rather than the receipt path: the
            // confirmation page is a normal WordPress page whose slug differs
            // per site, so matching "/receipt" would work on one site and
            // silently record nothing on the next.
            var params = new URLSearchParams(window.location.search);
            var orderHash =
                params.get("order_hash") || params.get("trx_hash");
            if (!orderHash) return;

            if (!firstTimeOnly(orderHash)) return;

            send("conversion", "purchase", { label: orderHash });
            // Marking happens inside firstTimeOnly, before the send. That is
            // safe only because send() now always reaches the buffer above --
            // if it could no-op, an order would be marked recorded and never
            // actually sent.
        } catch (error) {
            /* never break the receipt page */
        }
    })();

    // ---------------------------------------------------------------- forms

    /**
     * Core Forms dispatches 'cf-success' on the form element after a
     * successful AJAX submission.
     *
     * Listened for on document rather than per form: forms are rendered inside
     * page blocks and modals that may not exist at load, and a per-form
     * binding would miss every one of those.
     */
    document.addEventListener(
        "cf-success",
        safe(function (event) {
            var form =
                (event.target && event.target.closest
                    ? event.target.closest(".cf-form")
                    : null) || event.target;

            var formId =
                (form && form.getAttribute("data-form-id")) ||
                (form && form.id) ||
                "unknown";

            var override = NON_LEAD_FORMS[formId];
            if (override) {
                send("event", override, { label: String(formId) });
                return;
            }

            send("conversion", "lead", { label: String(formId) });
        }),
        true,
    );
})();
