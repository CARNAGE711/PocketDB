/**
 * FilesVault — binary file storage UI (images, PDFs, audio, ...).
 *
 * Files are uploaded as base64 into the database's hidden `_files`
 * collection via the engine's GridFS-style API. Supports drag & drop
 * anywhere in the vault, inline previews, opening with the OS default
 * app, save-as, and deletion.
 */
import {
  File as FileIcon, FileText, Film, FolderOpen, Image as ImageIcon,
  Music, Plus, Trash2, Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatBytes } from '../lib/utils.js';
import { Banner, Button, ConfirmDialog, Modal } from './ui.jsx';

const MAX_FILE_MB = 16;

/** Pick a lucide icon for the file's MIME type. */
function typeIcon(contentType) {
  if (contentType.startsWith('image/')) return ImageIcon;
  if (contentType.startsWith('video/')) return Film;
  if (contentType.startsWith('audio/')) return Music;
  if (contentType.startsWith('text/')) return FileText;
  return FileIcon;
}

export default function FilesVault({ db }) {
  const [files, setFiles] = useState([]);
  const [thumbs, setThumbs] = useState({}); // _id -> data URL (image previews)
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // full file incl. base64
  const [toDelete, setToDelete] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const load = () => api.listFiles(db).then(setFiles).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  /* Lazily render thumbnails for small image files (batched, cancellable). */
  useEffect(() => {
    let cancelled = false;
    const images = files.filter(
      (f) => f.contentType?.startsWith('image/') && f.size <= 2 * 1024 * 1024 && !thumbs[f._id]
    );
    (async () => {
      for (let i = 0; i < images.length; i += 4) {
        const batch = images.slice(i, i + 4);
        const found = {};
        await Promise.all(
          batch.map(async (f) => {
            try {
              const data = await api.getFile(db, f._id);
              found[f._id] = `data:${data.contentType};base64,${data.base64}`;
            } catch {
              /* fall back to the icon */
            }
          })
        );
        if (cancelled) return;
        setThumbs((prev) => ({ ...prev, ...found }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, db]);

  /** Read File objects as base64 and store them in the database. */
  const upload = async (fileList) => {
    const list = [...fileList];
    if (list.length === 0) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      for (const file of list) {
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          throw new Error(`"${file.name}" exceeds the ${MAX_FILE_MB} MB limit.`);
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
          reader.readAsDataURL(file);
        });
        const base64 = String(dataUrl).split(',')[1] || '';
        await api.putFile(db, file.name, base64, file.type || undefined);
      }
      await load();
      setNotice(`${list.length} file(s) stored in "${db}".`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async (file) => {
    setError(null);
    try {
      const data = await api.getFile(db, file._id);
      setPreview(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async () => {
    const file = toDelete;
    setToDelete(null);
    try {
      await api.deleteFile(db, file._id);
      await load();
      setNotice(`Deleted "${file.filename}".`);
    } catch (err) {
      setError(err.message);
    }
  };

  const isImage = (ct) => ct?.startsWith('image/');
  const isText = (ct) => ct?.startsWith('text/') || ct === 'application/json';

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      {/* header strip */}
      <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            files vault <span className="text-slate-700">//</span> <span className="normal-case text-slate-400">{db}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            {files.length} file(s) · stored as base64 documents in the hidden _files collection · max {MAX_FILE_MB} MB each
          </p>
        </div>
        <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Plus size={14} /> {busy ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="space-y-2 px-4 pt-3">
        {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
        {notice && <Banner kind="ok" onClose={() => setNotice(null)}>{notice}</Banner>}
      </div>

      {/* gallery / drop zone */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto p-4 transition-colors ${dragging ? 'bg-ink-900' : ''}`}
      >
        {files.length === 0 ? (
          <div
            className={`flex h-full min-h-[220px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragging ? 'border-brand-500 bg-ink-850' : 'border-ink-600'
            }`}
          >
            <Upload size={28} className="text-slate-600" />
            <p className="mt-3 text-sm font-medium text-slate-400">
              {dragging ? 'Drop to store' : 'Drag & drop files anywhere here'}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Images, PDFs, audio, video — kept inside the "{db}" database on disk
            </p>
            <Button variant="subtle" className="mt-4" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Plus size={14} /> Pick files
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {files.map((f) => {
              const Icon = typeIcon(f.contentType);
              return (
                <div
                  key={f._id}
                  className="group rounded-lg border border-ink-700 bg-ink-900 p-4 transition-colors hover:border-ink-600"
                >
                  <button onClick={() => openPreview(f)} className="flex w-full items-center gap-3 text-left" title="Preview">
                    {thumbs[f._id] ? (
                      <img
                        src={thumbs[f._id]}
                        alt={f.filename}
                        className="h-11 w-11 shrink-0 rounded-md border border-ink-700 object-cover"
                      />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-ink-800 text-slate-400 transition-colors group-hover:text-brand-300">
                        <Icon size={18} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-200">{f.filename}</span>
                      <span className="block font-mono text-[10px] text-slate-600">
                        {formatBytes(f.size)} · {f.uploadedAt?.slice(0, 10)}
                      </span>
                    </span>
                  </button>
                  <div className="mt-2.5 flex items-center justify-between">
                    <code className="truncate font-mono text-[10px] text-brand-300">{f.contentType}</code>
                    <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => api.openFileExternally(db, f._id).catch((e) => setError(e.message))}
                        title="Open with default app"
                        className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
                        aria-label="Open externally"
                      >
                        <FolderOpen size={12} />
                      </button>
                      <button
                        onClick={() => api.saveFileAs(db, f._id).catch((e) => setError(e.message))}
                        title="Save as…"
                        className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
                        aria-label="Save as"
                      >
                        <Upload size={12} />
                      </button>
                      <button
                        onClick={() => setToDelete(f)}
                        title="Delete file"
                        className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-rose-400"
                        aria-label="Delete file"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* preview modal */}
      {preview && (
        <Modal
          title={preview.filename}
          subtitle={`${formatBytes(preview.size)} · ${preview.contentType}`}
          onClose={() => setPreview(null)}
          width="max-w-3xl"
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => api.openFileExternally(db, preview._id).catch((e) => setError(e.message))}
              >
                <FolderOpen size={13} /> Open externally
              </Button>
              <Button
                variant="subtle"
                onClick={() => api.saveFileAs(db, preview._id).catch((e) => setError(e.message))}
              >
                <Upload size={13} /> Save as…
              </Button>
            </>
          }
        >
          {isImage(preview.contentType) ? (
            <img
              src={`data:${preview.contentType};base64,${preview.base64}`}
              alt={preview.filename}
              className="mx-auto max-h-[60vh] rounded-md"
            />
          ) : isText(preview.contentType) ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-ink-900 p-3 text-xs text-slate-300">
              {atob(preview.base64).slice(0, 20000)}
            </pre>
          ) : (
            <div className="py-10 text-center text-sm text-slate-500">
              No inline preview for this file type — use "Open externally" or "Save as…".
            </div>
          )}
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete "${toDelete.filename}" from the database? This cannot be undone.`}
          onCancel={() => setToDelete(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
