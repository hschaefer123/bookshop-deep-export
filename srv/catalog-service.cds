using {sap.capire.bookshop as db} from '../db/schema';

service CatalogService @(path: '/catalog') {

    entity Books as projection on db.Books;

    // Media entity used for deep import/export
    @odata.singleton
    @cds.persistence.skip
    entity DataMigration {
        @Core.MediaType: 'application/json'
        import : LargeBinary; // the stream import
    } actions {
        // the stream export
        action export(entitySet: String, selectedKeys: many Integer, format: String) returns LargeBinary @Core.MediaType: 'application/json';
    }
}
