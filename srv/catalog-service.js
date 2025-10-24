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
            // Deep Read JSON
            const deepQuery = buildDeepAdminQuery(Entity, entitySet);
            const q = SELECT.from(Entity, deepQuery).where({ ID: { in: selectedKeys } });
            const stream = await q.stream(); // admin texts
            return req.reply(stream, {
                filename: `${entitySet.split('.').pop()}.json`,
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

/**
 * Build a full deep read query for admin export (non-localized)
 * Includes all compositions recursively, and handles namespaced models.
 *
 * @param {object} entity - CDS entity definition
 * @param {string} entitySet - The top-level entity set (e.g. "Books")
 * @param {number} [depth=0] - Current recursion depth
 * @param {number} [maxDepth=5] - Maximum recursion depth
 * @returns {function} - CAP deep read builder lambda
 */
function buildDeepAdminQuery(entity, entitySet, depth = 0, maxDepth = 5) {
    if (!entity || depth > maxDepth) return e => e('*');

    // 🧩 Try to detect the namespace from the entity name
    const namespace = entity?.name?.includes('.')
        ? entity.name.split('.').slice(0, -1).join('.')
        : null;

    // derive short form of entitySet (e.g., "Books" from "sap.capire.bookshop.Books")
    const entitySetShort = entitySet.includes('.')
        ? entitySet.split('.').pop()
        : entitySet;

    return e => {
        e('*'); // Base columns

        // --- Recursive compositions only (clean CAP 9.x way)
        for (const [name, assoc] of Object.entries(entity.compositions || {})) {
            let target = cds.entities[assoc.target];

            // 🔹 Fallback 1: strip namespace from assoc.target
            if (!target && assoc.target?.includes('.')) {
                const shortName = assoc.target.split('.').pop();
                target = cds.entities[shortName];
            }

            // 🔹 Fallback 2: try with same entitySet base name (Books.texts, etc.)
            if (!target && entitySetShort && assoc.target?.includes(entitySetShort)) {
                const withoutNs = assoc.target.replace(namespace + '.', '');
                target = cds.entities[withoutNs];
            }

            // 🔹 Fallback 3: requalify using detected namespace
            if (!target && namespace) {
                const qualified = `${namespace}.${assoc.target.split('.').pop()}`;
                target = cds.entities[qualified] || cds.entities[assoc.target];
            }

            if (target) {
                e[name](buildDeepAdminQuery(target, entitySet, depth + 1, maxDepth));
            } else {
                console.warn(`⚠️ No target found for composition ${name} (${assoc.target})`);
                e[name]('*');
            }
        }
    };
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
