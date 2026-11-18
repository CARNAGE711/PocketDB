/**
 * Monaco Editor offline setup.
 *
 * @monaco-editor/react loads Monaco from a CDN by default; we instead pass
 * it a locally-bundled `monaco-editor` instance + workers so the studio is
 * fully offline (a core PocketDB requirement).
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { loader } from '@monaco-editor/react';

self.MonacoEnvironment = {
  getWorker() {
    // JSON is the only language we edit; the generic editor worker covers the rest.
    return new JsonWorker();
  },
};
void EditorWorker; // referenced so Vite emits the worker bundle

loader.config({ monaco });
