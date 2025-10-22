using CatalogService as service from '../../srv/catalog-service';

/*
annotate CatalogService.Books with @(
  UI.LineItem: [
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.ExportDeep', Label: 'Export Deep (Srv)' },
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.ImportDeep', Label: 'Import Deep (Srv)' }
  ]
);
*/
annotate service.Books with @(
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : ID,
            Label : 'ID',
        },
        {
            $Type : 'UI.DataField',
            Value : title,
            Label : 'title',
        },
        {
            $Type : 'UI.DataField',
            Value : author_ID,
            Label : 'author_ID',
        },
        {
            $Type : 'UI.DataField',
            Value : genre_ID,
            Label : 'genre_ID',
        },
    ]
);

