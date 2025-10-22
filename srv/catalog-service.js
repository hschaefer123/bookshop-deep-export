const cds = require('@sap/cds')
const { Readable } = require('stream');
const { chain } = require('stream-chain')
const { parser } = require('stream-json')
const { streamArray } = require('stream-json/streamers/StreamArray')

module.exports = cds.service.impl(async function () {

    // Handles PUT /catalog/DataMigration/import
    this.on('UPDATE', 'DataMigration', async (req) => {
        const entitySet = req._.req.headers['x-entity-set']
        const stream = req.data.import // Node.js Readable stream
        const Entity = cds.entities[entitySet]

        let count = 0
        const pipeline = chain([stream, parser(), streamArray()])

        for await (const { value } of pipeline) {
            // For CAP 9.5+: use cds.ql(INSERT.into(...)).stream(cds.parse.json(...))
            await INSERT.into(Entity).entries(value)
            count++
        }

        console.log(`✅ Imported ${count} records into ${entitySet}`)
        req._.res.setHeader('X-Imported-Count', count)
        return
    })

    // Handles GET /catalog/DataMigration/export
    this.on('export', async (req) => {
        const { entitySet, selectedKeys = [], format = 'json' } = req.data;
        const Entity = cds.entities[entitySet];
        if (!Entity) return req.reject(400, `Unknown entity: ${entitySet}`);
        if (!selectedKeys.length) return req.reject(400, 'No keys provided.');

        // --- JSON (default)
        if (format === 'json') {
            // Deep JSON
            const columns = buildDeepColumns(Entity);
            const q = cds.ql(SELECT.from(Entity).columns(columns).where({ ID: { in: selectedKeys } }));
            const stream = await q.localized.stream(); // localized texts
            return req.reply(stream, {
                filename: `${entitySet}.json`,
                contentType: 'application/json; charset=utf-8'
            });
        }

        // --- CSV export with localized data
        if (format === 'csv') {
            // Flat CSV
            const columns = buildFlatScalarColumns(Entity);
            if (!columns.length) return req.reject(400, 'No scalar columns to export for CSV.');

            const q = cds.ql(SELECT.from(Entity).columns(columns).where({ ID: { in: selectedKeys } }));
            const stream = Readable.from(async function* () {
                yield columns.join(';') + '\n'
                for await (const row of q.localized) { // localized texts
                    yield columns.map(c => escapeCsv(row[c])).join(';') + '\n';
                }
            }())

            return req.reply(stream, {
                filename: `${entitySet.split('.').pop()}.csv`,
                contentType: 'text/csv; charset=utf-8'
            });
        }

        // --- Unsupported format
        return req.reject(400, `Unsupported export format: ${format}`);
    });

})

// --- Deep (recursive) only JSON
function buildDeepColumns(entity, depth = 0, maxDepth = 5) {
    if (!entity || depth > maxDepth) return ['*'];
    const cols = ['*'];
    for (const [name, assoc] of Object.entries(entity.associations || {})) {
        if (assoc.isComposition) {
            const target = cds.entities[assoc.target];
            if (target) cols.push({ [name]: buildDeepColumns(target, depth + 1, maxDepth) });
        }
    }
    return cols;
}

// --- Flat (only scalar Root-Props) for CSV
function buildFlatScalarColumns(entity) {
    const cols = [];
    for (const [name, el] of Object.entries(entity.elements || {})) {
        // exclude: Associations/Compositions, Composition-keys, Draft/technical, Arrays/Structures
        if (el.isAssociation || el.isComposition) continue;
        if (el.elements) continue; // structured type
        if (el.virtual) continue;
        // optional: exclude technical fields
        if (['_createdAt', '_createdBy', '_modifiedAt', '_modifiedBy'].includes(name)) continue;

        cols.push(name);
    }
    return cols;
}

// CSV-escaping for ; and "
function escapeCsv(val) {
    if (val == null) return '';
    let s = String(val);
    if (s.includes('"')) s = s.replace(/"/g, '""');
    if (s.includes(';') || s.includes('\n') || s.includes('\r')) s = `"${s}"`;
    return s;
}
