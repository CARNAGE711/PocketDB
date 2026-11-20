/**
 * DocsPanel — in-app quick reference (docs without leaving the studio).
 * Curated sections mirroring the README: connections, querying, pipelines,
 * files, indexes/schema/history, server bridge, keyboard.
 */
import { BookOpen } from 'lucide-react';
import { Modal } from './ui.jsx';

function Section({ title, children }) {
  return (
    <section className="border-b border-ink-800 py-4 last:border-0">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-brand-300">{title}</h3>
      <div className="space-y-1.5 text-xs leading-relaxed text-slate-400">{children}</div>
    </section>
  );
}

function Cmd({ children }) {
  return <code className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{children}</code>;
}

export default function DocsPanel({ onClose }) {
  return (
    <Modal
      title="PocketDB quick reference"
      subtitle="Everything the studio can do, in one page"
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="mb-3 flex items-center gap-2 text-slate-500">
        <BookOpen size={14} />
        <span className="text-[11px]">The full README ships with the project: <Cmd>pocketdb/README.md</Cmd></span>
      </div>

      <Section title="Connections">
        <p>A connection is a <Cmd>pocketdb:///C:/path/to/data</Cmd> URI pointing at a local data directory. Favorites auto-connect on launch; the back arrow (top-left) returns to the Launchpad. If a data directory was encrypted, connect with the passphrase from the Advanced section of the connection form.</p>
      </Section>

      <Section title="Querying, explain & saved views">
        <p>Open a collection, expand the <b>filter console</b> (bottom strip) and write JSON — dot-notation fields, <Cmd>$eq $ne $gt $gte $lt $lte $in $nin $regex $exists</Cmd>, top-level <Cmd>$and/$or/$not</Cmd>, and full-text <Cmd>{'{"$text": {"$search": "term"}}'}</Cmd>. The <b>Builder</b> tab builds the same filter with chips. Documents load in pages (25–250) with prev/next; Grid supports inline cell editing (double-click), Ledger and JSON expand to full documents.</p>
        <p><b>Explain</b> in the filter console reports the plan: index scan vs full collection scan, candidates examined, matches and timing. <b>Save as view</b> in Pipeline studio turns a pipeline into a named, read-only collection — views appear in the dashboard and switchers with an eye badge and can be queried, exported and charted, but never edited.</p>
      </Section>

      <Section title="Indexes, schema & history">
        <p><b>Indexes</b> (key icon in the collection header) build sidecar maps that prune equality/<Cmd>$in</Cmd> scans. Single-field, <b>compound</b> (<Cmd>a+b</Cmd>) and <b>unique</b> indexes are supported; unique violations are rejected before any write. <b>Schema rules</b> (shield icon) validate every insert/update: required fields, types, enums. <b>Schema analyzer</b> (scan icon) maps every dotted field path with fill rate, types, distinct counts and samples. Every edit and delete is recorded in the <b>history log</b> (clock icon on a document) — restore any revision with one click.</p>
      </Section>

      <Section title="Activity & trash">
        <p>The navbar <b>Activity</b> tool (Alt+5) is a live feed of inserts, updates, deletes, imports, index changes, views, restores and snapshots. The <b>Trash</b> tool (Alt+6) keeps the newest 500 deleted documents per database — restore one into its original collection or purge it permanently.</p>
      </Section>

      <Section title="Aggregation pipeline">
        <p>Pipeline studio stages: <Cmd>$match $sort $limit $skip $project $count $unwind</Cmd>, plus <Cmd>$group</Cmd> (with <Cmd>$sum $avg $min $max $push $addToSet</Cmd> accumulators), <Cmd>$lookup</Cmd> (join another collection) and <Cmd>$replaceRoot</Cmd>. Press <b>Chart results</b> to plot the output as bars or a donut.</p>
      </Section>

      <Section title="Files vault">
        <p>Drag & drop binaries into the vault: images get thumbnails and previews; everything is stored base64 in a hidden <Cmd>_files</Cmd> collection inside the database folder. 16 MB per file, open externally or save as.</p>
      </Section>

      <Section title="Snapshots & schedules">
        <p>The navbar <b>Snapshots</b> tool copies the whole database folder to a timestamped backup outside the data directory, with one-click restore. Turn on <b>Scheduled snapshots</b> in the same dialog to snapshot every database in the directory on an interval (minimum 1 minute), keeping only the newest N per database.</p>
      </Section>

      <Section title="Import & export">
        <p><b>Import</b> reads JSON arrays, NDJSON or CSV files into a collection (up-arrow icon). <b>Export</b> writes JSON/CSV. <b>Import from MongoDB</b> mirrors a live <Cmd>mongodb://</Cmd> server into your data directory (ObjectIds become hex strings, Dates become ISO strings).</p>
      </Section>

      <Section title="Server mode & live sync">
        <p>The status-strip server chip opens the <b>HTTP bridge</b> — a REST API on <Cmd>http://127.0.0.1:7400/api/…</Cmd> with optional bearer-token and LAN binding, plus a per-collection SSE change feed at <Cmd>/api/:db/:coll/events</Cmd>. The studio also watches the data directory: external writes appear automatically (live sync).</p>
      </Section>

      <Section title="MCP server">
        <p>PocketDB ships a standalone <b>MCP server</b> (<Cmd>electron/mcp-server.cjs</Cmd>) that exposes the engine to Claude Desktop, Cursor or any MCP client over stdio. Open <b>MCP server</b> from the palette to copy the command and a ready-to-paste <Cmd>mcpServers</Cmd> config for the connected data directory.</p>
      </Section>

      <Section title="Keyboard, tabs & navbar">
        <p><Cmd>Ctrl+K</Cmd> command palette · <Cmd>Ctrl+/</Cmd> shortcuts · <Cmd>Alt+1…7</Cmd> dashboard / collection / pipeline / files / activity / trash / schema analyzer · <Cmd>Esc</Cmd> close overlays.</p>
        <p>Opening collections keeps them as <b>tabs</b> under the navbar (persisted across launches); close one with its × and the neighbour takes over. The navbar's labeled data-tools cluster (right of the breadcrumb) opens the <b>files vault</b>, <b>imports</b> (file & MongoDB), <b>snapshots</b>, <b>activity</b> and <b>trash</b> from anywhere — they live only there. <Cmd>←</Cmd> walks back through your recent locations (it never leaves the studio); the start page is the right-edge button or the status-strip connection chip. The collection switcher supports a filter box, <b>★ pinned</b> collections (kept at the top) and your recent collections.</p>
      </Section>
    </Modal>
  );
}
