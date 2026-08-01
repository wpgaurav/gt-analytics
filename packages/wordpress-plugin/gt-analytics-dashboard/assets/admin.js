(function () {
    "use strict";

    var roots = Array.prototype.slice.call(document.querySelectorAll("[data-gtad-root]"));
    var config = window.gtAnalyticsDashboard;

    if (!roots.length || !config) {
        return;
    }

    function refresh(root) {
        if (root.dataset.refreshing === "true" || document.hidden) {
            return;
        }

        root.dataset.refreshing = "true";
        root.classList.add("is-refreshing");

        var body = new window.URLSearchParams();
        body.set("action", config.action);
        body.set("nonce", config.nonce);
        body.set("view", root.dataset.gtadView || "widget");

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
                root.innerHTML = response.data.html;
            })
            .catch(function () {
                var status = root.querySelector("[aria-live]");
                if (status) {
                    status.textContent = "Could not refresh. Existing data is still shown.";
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
            }
        });
    });

    window.setInterval(function () {
        roots.forEach(function (root) {
            refresh(root);
        });
    }, 30000);
})();
