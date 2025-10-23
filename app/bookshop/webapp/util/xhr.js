sap.ui.define([], function () {
    "use strict";

    /**
     * Helper utilities for fetch-based calls in Fiori Extensions
     * Provides CSRF handling and file download helpers.
     */

    async function getCsrfToken(serviceUrl = "/catalog/") {
        const res = await fetch(serviceUrl, { method: "GET", headers: { "x-csrf-token": "Fetch" } });
        return res.headers.get("x-csrf-token") || "";
    }

    function jsonHeaders(token) {
        return {
            "Content-Type": "application/json",
            "x-csrf-token": token
        };
    }

    // Return object (export equivalent)
    return {
        getCsrfToken,
        jsonHeaders
    };
});
