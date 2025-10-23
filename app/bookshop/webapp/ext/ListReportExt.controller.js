sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "../util/StreamUtils",
], function (ControllerExtension, MessageToast, MessageBox, StreamUtils) {
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
            const i18n = view.getModel("i18n").getResourceBundle();

            // Retrieve selected contexts (for ListReport / MDC table)
            const table = view.byId("fe::table::Books::LineItem-innerTable");
            const contexts = table?.getSelectedContexts?.() || [];

            if (!contexts.length) {
                MessageBox.information(i18n.getText("msgNoSelection"));
                return;
            }

            MessageToast.show(i18n.getText("msgExportStarted"));

            // Collect IDs of selected rows
            const selectedKeys = contexts.map(ctx => ctx.getObject().ID);
            const entitySet = this.getTableEntitySetName(table);

            await StreamUtils.exportData({
                url: "/catalog/DataMigration/export",
                entitySet,
                selectedKeys,
                format,
                i18n
            });
        },

        /**
         * Trigger deep JSON import by uploading a file.
         * Sends the JSON file as raw stream body to ImportDeep action.
         */
        import: async function (_format) {
            const view = this.base.getView();
            const i18n = view.getModel("i18n").getResourceBundle();
            const table = view.byId("fe::table::Books::LineItem-innerTable");
            const entitySet = this.getTableEntitySetName(table);

            await StreamUtils.importData({
                url: "/catalog/DataMigration/import",
                entitySet,
                i18n
            });

            // refresh list binding to show new records
            this.getTableBinding(table)?.refresh?.();
        },

        getTableBinding: function (table) {
            return table.getBinding("rows") || table.getBinding("items");
        },

        getTableEntitySetName: function (table) {
            const oBinding = this.getTableBinding(table);
            const sPath = oBinding?.getPath(); // /Books
            return sPath ? sPath.replace("/", "") : null; // Books"
        }

    });
});
