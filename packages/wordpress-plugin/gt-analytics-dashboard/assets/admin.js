(function () {
    "use strict";

    var roots = Array.prototype.slice.call(
        document.querySelectorAll("[data-gtad-root]"),
    );
    var config = window.gtAnalyticsDashboard;

    if (!roots.length || !config) {
        return;
    }

    function stateFromRoot(root) {
        var interval = root.querySelector("[data-gtad-interval]");
        var filters = {};
        root.querySelectorAll("[data-gtad-active-filter]").forEach(
            function (badge) {
                filters[badge.dataset.filterKey] = badge.dataset.filterValue;
            },
        );
        return {
            interval: interval
                ? interval.value !== "custom"
                    ? interval.value
                    : interval.dataset.gtadCurrentInterval || "30d"
                : "30d",
            filters: filters,
        };
    }

    function refresh(root, nextState) {
        if (root.dataset.refreshing === "true" || document.hidden) {
            return;
        }

        var state = nextState || stateFromRoot(root);

        root.dataset.refreshing = "true";
        root.classList.add("is-refreshing");

        var body = new window.URLSearchParams();
        body.set("action", config.action);
        body.set("nonce", config.nonce);
        body.set("view", root.dataset.gtadView || "widget");
        body.set("interval", state.interval || "30d");
        Object.keys(state.filters || {}).forEach(function (key) {
            body.set(key, state.filters[key]);
        });

        window
            .fetch(config.ajaxUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                },
                body: body.toString(),
            })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("Refresh failed");
                }
                return response.json();
            })
            .then(function (response) {
                if (
                    !response.success ||
                    !response.data ||
                    !response.data.html
                ) {
                    throw new Error("Invalid refresh response");
                }
                root.innerHTML = response.data.html;
                if ((root.dataset.gtadView || "widget") === "dashboard") {
                    var url = new window.URL(window.location.href);
                    url.searchParams.set("interval", state.interval || "30d");
                    [
                        "path",
                        "referrer",
                        "deviceModel",
                        "deviceType",
                        "country",
                        "browserName",
                        "browserVersion",
                        "utmSource",
                        "utmMedium",
                        "utmCampaign",
                        "utmTerm",
                        "utmContent",
                        "channel",
                        "referrerHost",
                    ].forEach(function (key) {
                        if (state.filters && state.filters[key]) {
                            url.searchParams.set(key, state.filters[key]);
                        } else {
                            url.searchParams.delete(key);
                        }
                    });
                    window.history.replaceState({}, "", url.toString());
                }
            })
            .catch(function () {
                var status = root.querySelector("[aria-live]");
                if (status) {
                    status.textContent =
                        "Could not refresh. Existing data is still shown.";
                }
            })
            .finally(function () {
                root.dataset.refreshing = "false";
                root.classList.remove("is-refreshing");
            });
    }

    roots.forEach(function (root) {
        root.addEventListener("click", function (event) {
            if (event.target.closest("[data-gtad-refresh]")) {
                refresh(root);
                return;
            }

            var filter = event.target.closest("[data-gtad-filter-key]");
            if (filter) {
                var filteredState = stateFromRoot(root);
                filteredState.filters[filter.dataset.gtadFilterKey] =
                    filter.dataset.gtadFilterValue;
                refresh(root, filteredState);
                return;
            }

            var remove = event.target.closest("[data-gtad-filter-remove]");
            if (remove) {
                var removeState = stateFromRoot(root);
                delete removeState.filters[remove.dataset.gtadFilterRemove];
                refresh(root, removeState);
                return;
            }

            if (event.target.closest("[data-gtad-filters-clear]")) {
                var clearState = stateFromRoot(root);
                clearState.filters = {};
                refresh(root, clearState);
                return;
            }

            var channel = event.target.closest("[data-gtad-channel]");
            if (channel) {
                var channelState = stateFromRoot(root);
                if (channel.dataset.gtadChannel) {
                    channelState.filters.channel = channel.dataset.gtadChannel;
                } else {
                    delete channelState.filters.channel;
                }
                refresh(root, channelState);
                return;
            }

            if (event.target.closest("[data-gtad-range-apply]")) {
                var start = root.querySelector("[data-gtad-range-start]");
                var end = root.querySelector("[data-gtad-range-end]");
                if (
                    start &&
                    end &&
                    start.value &&
                    end.value &&
                    start.value <= end.value
                ) {
                    var rangeState = stateFromRoot(root);
                    rangeState.interval = start.value + ".." + end.value;
                    refresh(root, rangeState);
                }
            }
        });

        root.addEventListener("change", function (event) {
            var picker = event.target.closest("[data-gtad-interval]");
            if (!picker) return;
            if (picker.value === "custom") {
                var custom = root.querySelector(".gtad-custom-range");
                if (custom) custom.classList.add("is-visible");
                return;
            }
            var rangeState = stateFromRoot(root);
            rangeState.interval = picker.value;
            refresh(root, rangeState);
        });
    });

    window.setInterval(function () {
        roots.forEach(function (root) {
            refresh(root);
        });
    }, 30000);
})();
