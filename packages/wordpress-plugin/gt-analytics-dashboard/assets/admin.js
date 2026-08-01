(function () {
    "use strict";

    var widget = document.querySelector("#gt_analytics_dashboard_widget");
    var config = window.gtAnalyticsDashboard;

    if (!widget || !config) {
        return;
    }

    var refreshing = false;

    function refresh() {
        if (refreshing || document.hidden) {
            return;
        }

        refreshing = true;
        widget.classList.add("is-refreshing");

        var body = new window.URLSearchParams();
        body.set("action", config.action);
        body.set("nonce", config.nonce);

        window.fetch(config.ajaxUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: body.toString(),
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("Refresh failed");
                }
                return response.json();
            })
            .then(function (response) {
                if (!response.success || !response.data || !response.data.html) {
                    throw new Error("Invalid refresh response");
                }
                var inside = widget.querySelector(".inside");
                if (inside) {
                    inside.innerHTML = response.data.html;
                }
            })
            .catch(function () {
                var status = widget.querySelector("[aria-live]");
                if (status) {
                    status.textContent = "Could not refresh. Existing data is still shown.";
                }
            })
            .finally(function () {
                refreshing = false;
                widget.classList.remove("is-refreshing");
            });
    }

    widget.addEventListener("click", function (event) {
        if (event.target.closest("[data-gtad-refresh]")) {
            refresh();
        }
    });

    window.setInterval(refresh, 30000);
})();
