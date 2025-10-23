sap.ui.define([
    "sap/ui/export/ExportUtils",
    "sap/ui/unified/FileUploader",
    "sap/ui/unified/FileUploaderParameter",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (ExportUtils, FileUploader, FileUploaderParameter, MessageToast, MessageBox) {
    "use strict";

    /**
     * Utility for CAP streaming import/export handling.
     * Supports deep JSON/CSV export and large streamed uploads.
     */
    const StreamUtils = {

        /**
         * Retrieve CSRF token for a given service URL.
         * Automatically derives the service root (e.g. /catalog/).
         * Optionally accepts an override token.
         *
         * @param {string} url Full CAP service endpoint (e.g. /catalog/DataMigration/export)
         * @param {string} [tokenOverride] Optional externally provided CSRF token
         * @returns {Promise<string>} CSRF token string
         */
        async _getCsrfToken(url, tokenOverride) {
            if (tokenOverride) return tokenOverride;

            // 🧩 Skip token fetch in local dev mode (CAP usually disables CSRF for localhost)
            const hostname = window.location.hostname;
            if (hostname === "localhost" || hostname === "127.0.0.1") {
                //console.debug("[StreamUtils] Skipping CSRF token fetch on localhost");
                return null;
            }

            // Derive base service path → e.g. /catalog/ from /catalog/DataMigration/export
            const parts = url.split("/");
            const base = parts.length > 1 ? `/${parts[1]}/` : "/";

            const res = await fetch(base, { headers: { "x-csrf-token": "fetch" } });
            const token = res.headers.get("x-csrf-token");

            if (!token) throw new Error(`Failed to fetch CSRF token for ${base}`);
            return token;
        },

        /**
         * Download data from CAP as streamed export.
         * - Uses Fetch Streams API when supported (Chromium)
         * - Falls back to Blob + ExportUtils for other browsers
         *
         * @param {object} opts
         * @param {string} opts.url CAP endpoint for export
         * @param {string} opts.entitySet CAP entity name
         * @param {array} opts.selectedKeys Table selection keys
         * @param {string} [opts.format="json"] File format (json | csv)
         * @param {object} [opts.i18n] Optional i18n resource bundle
         * @param {string} [opts.token] Optional externally provided CSRF token
         */
        async exportData({ url, entitySet, selectedKeys, format = "json", i18n, token }) {
            try {
                const csrf = await this._getCsrfToken(url, token);
                const filename = `${entitySet.split(".").pop()}.${format}`;

                const res = await fetch(url, {
                    method: "POST",
                    headers: {
                        "x-csrf-token": csrf,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ entitySet, selectedKeys, format })
                });

                if (!res.ok) throw new Error(`Export failed with HTTP ${res.status}`);

                // @ts-ignore
                const canStream = !!(res.body && window.showSaveFilePicker);

                // --- Chromium streaming download path
                if (canStream) {
                    // @ts-ignore
                    const handle = await window.showSaveFilePicker({ suggestedName: filename });
                    const writable = await handle.createWritable();

                    const reader = res.body.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        await writable.write(value);
                    }
                    await writable.close();

                    MessageToast.show(i18n?.getText("msgExportDone") || "Export completed");
                    return;
                }

                // --- Fallback: Blob-based download (Safari/Firefox)
                const blob = await res.blob();
                ExportUtils.saveAsFile(blob, filename);
                // message comes too early! no promise/callback with saveAsFile available
                MessageToast.show(i18n?.getText("msgFallbackExportDone") || "Export completed (fallback)");
            } catch (e) {
                console.error("[StreamUtils.exportData] failed:", e);
                MessageBox.error(`Export failed: ${e.message}`);
            }
        },

        /**
         * Upload data to CAP via PUT using streaming.
         * - Opens file picker dialog
         * - Streams file directly via fetch(file)
         * - Sends entitySet as header
         *
         * @param {object} opts
         * @param {string} opts.url CAP import endpoint
         * @param {string} opts.entitySet CAP entity name
         * @param {object} [opts.i18n] Optional i18n resource bundle
         * @param {string} [opts.token] Optional externally provided CSRF token
         */
        async importData({ url, entitySet, i18n, token }) {
            try {
                // Create hidden file input dynamically
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "application/json";
                input.style.display = "none";
                document.body.appendChild(input);

                MessageToast.show(i18n?.getText("msgImportStarted") || "Import startet");

                // Promise-based file selection
                const file = await new Promise((resolve, reject) => {
                    input.onchange = () => resolve(input.files[0]);
                    input.click();
                    setTimeout(() => reject(new Error("File selection timed out")), 60000);
                });
                document.body.removeChild(input);

                if (!file) return;

                // Get CSRF token (either provided or auto-derived)
                const csrf = await this._getCsrfToken(url, token);

                // Stream upload directly (Browser handles chunking)
                const res = await fetch(url, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "x-csrf-token": csrf,
                        "x-entity-set": entitySet
                    },
                    body: file
                });

                if (!res.ok) throw new Error(`Import failed with HTTP ${res.status}`);

                // CAP returns number of imported root entities
                const created = res.headers.get("X-Imported-Count") || 0;
                MessageToast.show(i18n.getText("msgImportDone", [created]));
            } catch (e) {
                console.error("[StreamUtils.importData] failed:", e);
                MessageBox.error(`Import failed: ${e.message}`);
            }
        },

        /**
         * Upload file to CAP using FileUploader API (no UI visible).
         * (currently not working, maybe use in dialog scenario)
         */
        async uploadFile({ url, entitySet, i18n, token }) {
            // Get CSRF token (either provided or auto-derived)´                
            const csrf = await this._getCsrfToken(url, token);

            return new Promise((resolve, reject) => {
                // Create uploader instance (invisible)
                const uploader = new FileUploader({
                    visible: false,
                    name: "file",
                    uploadUrl: url,
                    sendXHR: true,                // use XMLHttpRequest → supports headers
                    useMultipart: false,          // send raw body (not form-data)
                    headerParameters: [
                        new FileUploaderParameter({
                            name: "x-entity-set",
                            value: entitySet
                        }),
                        new FileUploaderParameter({
                            name: "x-csrf-token",
                            value: csrf || ""
                        })
                    ],
                    change: (oEvent) => {
                        // File selected → trigger upload
                        uploader.upload();
                    },
                    uploadComplete: (oEvent) => {
                        MessageToast.show(i18n?.getText("msgImportOk") || "Import completed");
                        uploader.destroy(); // ✅ Cleanup after completion
                        resolve();
                    },
                    uploadAborted: (oEvent) => {
                        uploader.destroy(); // ✅ Cleanup after abort
                        reject(new Error("Upload aborted"));
                    },
                    uploadProgress: (oEvent) => {
                        console.log("Upload progress:", oEvent.getParameter("loaded"));
                    }
                });

                // Add to page (required for rendering, can be hidden)
                sap.ui.getCore().getUIArea("content")?.addContent(uploader);

                // !!! not working
                uploader.openFilePicker()

                // Safety cleanup after timeout (failsafe)
                /*
                setTimeout(() => {
                    if (!uploader.bIsDestroyed) {
                        console.debug("[FileUploader] Auto-cleanup after timeout");
                        uploader.destroy();
                    }
                }, 120000);
                */
            });
        }
    };

    return StreamUtils;
});
