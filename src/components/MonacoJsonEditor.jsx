/**
 * Monaco JSON editor wrapper (bundled locally — see lib/monacoSetup.js).
 * Used for: query filters, insert/edit documents, aggregation stage specs.
 */
import Editor from '@monaco-editor/react';
import '../lib/monacoSetup.js';

export default function MonacoJsonEditor({ value, onChange, height = 180, readOnly = false }) {
  return (
    <div className="overflow-hidden rounded-md border border-ink-600">
      <Editor
        height={height}
        defaultLanguage="json"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange?.(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          readOnly,
          automaticLayout: true,
          formatOnPaste: true,
          renderLineHighlight: 'none',
          padding: { top: 8, bottom: 8 },
        }}
        loading={
          <div className="flex h-full items-center justify-center bg-ink-900 text-xs text-slate-500">
            Loading editor…
          </div>
        }
      />
    </div>
  );
}
