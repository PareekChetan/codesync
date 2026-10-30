import { PreviewFrame } from './PreviewFrame';

export interface SharedRun {
  by: string;
  at: number;
  language: string;
  durationMs: number;
  timedOut: boolean;
  logs: { level: 'log' | 'error' | 'warn' | 'info'; text: string }[];
  /** Set for HTML rooms: the page to show in the live preview. */
  html?: string;
}

interface Props {
  run: SharedRun | null;
  runningBy: string | null;
  runnable: boolean;
  languageLabel: string;
  stdin: string;
  onStdinChange: (value: string) => void;
}

export function OutputPanel({ run, runningBy, runnable, languageLabel, stdin, onStdinChange }: Props) {
  const isHtml = languageLabel === 'HTML';

  if (isHtml) {
    return (
      <aside className="side side-preview">
        <section className="output">
          <header className="panel-header">
            <span>Preview</span>
            {run?.html !== undefined && (
              <span className="output-meta">
                {run.by} · {new Date(run.at).toLocaleTimeString()}
              </span>
            )}
          </header>
          {run?.html !== undefined ? (
            <PreviewFrame html={run.html} runAt={run.at} />
          ) : (
            <div className="output-body">
              <p className="muted">
                Press <kbd>Run</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to preview this page. Everyone in the room sees it.
              </p>
            </div>
          )}
        </section>
      </aside>
    );
  }

  return (
    <aside className="side">
      <section className="input-section">
        <header className="panel-header">
          <label htmlFor="stdin">Input (stdin)</label>
          <span className="output-meta">shared with the room</span>
        </header>
        <textarea
          id="stdin"
          className="stdin"
          value={stdin}
          onChange={(e) => onStdinChange(e.target.value)}
          placeholder={'Input your program reads, e.g.\n5\n1 2 3 4 5'}
          spellCheck={false}
          disabled={!runnable}
        />
      </section>

      <section className="output" aria-live="polite">
        <header className="panel-header">
          <span>Output</span>
          {run && !runningBy && (
            <span className="output-meta">
              {run.by} · {run.language} · {run.durationMs} ms · {new Date(run.at).toLocaleTimeString()}
            </span>
          )}
        </header>
        <div className="output-body">
          {!runnable && <p className="muted">{languageLabel} files can’t be run. Switch to a programming language to use Run.</p>}
          {runnable && runningBy && <p className="muted">Running{runningBy ? ` (started by ${runningBy})` : ''}…</p>}
          {runnable && !runningBy && !run && (
            <p className="muted">
              Press <kbd>Run</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. Everyone in the room sees the result.
            </p>
          )}
          {runnable && !runningBy && run && run.logs.length === 0 && <p className="muted">Program finished with no output.</p>}
          {runnable &&
            !runningBy &&
            run?.logs.map((line, i) => (
              <pre key={i} className={`log log-${line.level}`}>
                {line.text}
              </pre>
            ))}
        </div>
      </section>
    </aside>
  );
}
