sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../util/xhr"
], function (ControllerExtension, MessageToast, MessageBox, xhr) {
    "use strict";

    /**
     * Fiori Elements V4 List Report Controller Extension
     * Handles Deep Export (download JSON) and Deep Import (upload JSON)
     * Compatible with CAP 9.4 streaming API and CAP 9.5 future INSERT.stream()
     */
    return ControllerExtension.extend("bookshop.ext.ListReportExt", {

        onExportJSON: function () {
            this.export("json")
        },

        onImportJSON: function () {
            this.import("json")
        },

        onExportCSV: function () {
            this.export("csv")
        },

        /**
         * Trigger deep JSON export for selected rows.
         * Reads selected Books, posts IDs to ExportDeep action,
         * and downloads the streamed JSON file.
         */
        export: async function (format = "json") {
            const view = this.base.getView();
            //const model = view.getModel(); // OData V4 model instance
            const i18n = view.getModel("i18n").getResourceBundle();

            // Retrieve selected contexts (for ListReport / MDC table)
            const table = view.byId("fe::table::Books::LineItem-innerTable");
            const contexts = table?.getSelectedContexts?.() || [];
            const entitySet = this.getTableEntitySetName(table);

            if (!contexts.length) {
                MessageBox.information(i18n.getText("msgNoSelection"));
                return;
            }

            MessageToast.show(i18n.getText("msgExportStarted"));

            // Collect UUIDs of selected rows
            const selectedKeys = contexts.map(ctx => ctx.getObject().ID);

            // editFlow.invokeAction does not support stream response yet,
            // so we use fetch() directly here.
            try {
                const token = await xhr.getCsrfToken("/catalog/");

                // Call CAP action exportJSON (unbound)
                const res = await fetch("/catalog/DataMigration/export", {
                    method: "POST",
                    headers: xhr.jsonHeaders(token),
                    body: JSON.stringify({
                        entitySet: entitySet,
                        selectedKeys,
                        format: format
                    })
                });

                if (!res.ok) {
                    throw new Error(`Export failed with HTTP ${res.status}`);
                }

                // Streamed JSON → blob download                
                const blob = await res.blob();
                xhr.downloadBlob(blob, `${entitySet}.${format}`);
                MessageToast.show(i18n.getText("msgExportDone"));
            } catch (err) {
                MessageBox.error(err.message || "Export failed");
            }
        },

        /**
         * Trigger deep JSON import by uploading a file.
         * Sends the JSON file as raw stream body to ImportDeep action.
         */
        import: async function (format) {
            const view = this.base.getView();
            const i18n = view.getModel("i18n").getResourceBundle();
            const table = view.byId("fe::table::Books::LineItem-innerTable");
            const entitySet = this.getTableEntitySetName(table);

            // Create hidden file input
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.style.display = "none";
            document.body.appendChild(input);

            const pickFile = () =>
                new Promise((resolve, reject) => {
                    input.onchange = () => resolve(input.files[0]);
                    input.click();
                    setTimeout(() => reject(new Error("cancelled")), 60000);
                });

            try {
                const file = await pickFile();
                if (!file) return;

                MessageToast.show(i18n.getText("msgImportOk"));

                const token = await xhr.getCsrfToken("/catalog/");

                /**
                 * OData V4 stream parameter mapping:
                 * - non-stream params → query string
                 * - stream param → raw request body
                 */
                //const url = `/catalog/importJSON(entity='${entitySetName}')`;
                const url = '/catalog/DataMigration/import';

                const res = await fetch(url, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json", // matches @Core.MediaType
                        "x-csrf-token": token,
                        "x-entity-set": entitySet
                    },
                    body: file // Browser streams file content automatically
                });

                if (!res.ok) {
                    const text = await res.text().catch(() => "");
                    throw new Error(`${i18n.getText("errImport")}: ${res.status} ${text}`);
                }

                // CAP returns number of imported root entities
                const created = res.headers.get("X-Imported-Count") || 0;

                MessageToast.show(i18n.getText("msgImportDone", [created]));

                // Optional: refresh table binding
                const oBinding = table.getBinding("rows") || table.getBinding("items");
                oBinding?.refresh?.();

            } catch (err) {
                if (err.message !== "cancelled") {
                    MessageBox.error(err.message || i18n.getText("errImport"));
                }
            } finally {
                document.body.removeChild(input);
            }
        },

        getTableEntitySetName: function (table) {
            const oBinding = table.getBinding("rows") || table.getBinding("items");
            const sPath = oBinding?.getPath(); // -> z. B. "/Books"
            return sPath ? sPath.replace("/", "") : null; // -> "Books"
        }

    });
});
