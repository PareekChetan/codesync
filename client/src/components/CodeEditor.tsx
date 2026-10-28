import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Language } from '../lib/api';
import { languageExtension } from '../lib/editorLanguages';

interface Props {
  ytext: Y.Text;
  awareness: Awareness;
  language: Language;
  onRun?: () => void;
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--editor-bg)' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace", lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', border: 'none' },
  '.cm-content': { padding: '12px 0' },
  '.cm-ySelectionInfo': {
    fontFamily: 'Inter, sans-serif',
    fontSize: '11px',
    fontWeight: '600',
    padding: '1px 5px',
    borderRadius: '4px 4px 4px 0',
    opacity: '1',
    top: '-1.35em',
  },
});

/**
 * CodeMirror 6 bound to a shared Y.Text.
 * yCollab handles two-way sync, remote cursors/selections, and a
 * per-user undo stack (Ctrl+Z undoes YOUR edits, not your teammate's).
 */
export function CodeEditor({ ytext, awareness, language, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  useEffect(() => {
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          keymap.of([
            ...yUndoManagerKeymap,
            indentWithTab,
            { key: 'Mod-Enter', run: () => (onRunRef.current?.(), true) },
          ]),
          basicSetup,
          oneDark,
          theme,
          languageSlot.current.of(languageExtension(language)),
          yCollab(ytext, awareness, { undoManager }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      undoManager.destroy();
      viewRef.current = null;
    };
    // The editor is rebuilt only when the underlying document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext, awareness]);

  // Swap syntax highlighting in place without losing cursor or undo history.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageSlot.current.reconfigure(languageExtension(language)) });
  }, [language]);

  return <div className="editor-host" ref={host} />;
}
