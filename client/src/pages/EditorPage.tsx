import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CodeEditor } from '../components/CodeEditor';
import { OutputPanel, type SharedRun } from '../components/OutputPanel';
import { PresenceBar } from '../components/PresenceBar';
import { api, ApiError, type Language, type Room, type RunResult } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cssPreviewPage, LANGUAGES, languageLabel } from '../lib/languages';
import { runJavaScript } from '../lib/runner';
import { useCollabRoom } from '../lib/useCollabRoom';

/**
 * Shared document layout (all live-synced via the CRDT):
 *   doc.getText('code')  - the source code
 *   doc.getMap('meta')   - room settings: language, shared stdin
 *   doc.getMap('run')    - who is running right now + the latest output, so everyone sees it
 */

interface RunningState {
  by: string;
  at: number;
}

/** Turn the runner's response into display lines. */
function toLogs(result: RunResult): SharedRun['logs'] {
  const logs: SharedRun['logs'] = [];
  if (result.phase === 'compile') logs.push({ level: 'error', text: 'Compilation failed:' });
  if (result.stdout) logs.push({ level: 'log', text: result.stdout.replace(/\n$/, '') });
  if (result.stderr) logs.push({ level: 'error', text: result.stderr.replace(/\n$/, '') });
  if (result.timedOut) logs.push({ level: 'error', text: 'Stopped: time or memory limit exceeded.' });
  else if (result.truncated) logs.push({ level: 'warn', text: 'Output too long, truncated at 64 KB.' });
  else if (result.phase === 'run' && result.exitCode !== 0) {
    logs.push({ level: 'info', text: `Process exited with code ${result.exitCode}` });
  }
  return logs;
}
export function EditorPage() {
  const { roomId = '' } = useParams();
  const { user, token } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('javascript');
  const [lastRun, setLastRun] = useState<SharedRun | null>(null);
  const [runningBy, setRunningBy] = useState<string | null>(null);
  const [stdin, setStdin] = useState('');
  const [copied, setCopied] = useState(false);
  const { room: collab, status, synced, peers } = useCollabRoom(roomId, token, user);

  useEffect(() => {
    api
      .getRoom(roomId)
      .then(({ room }) => {
        setRoom(room);
        setLanguage(room.language);
        document.title = `${room.name} · CodeSync`;
      })
      .catch((err) => setLoadError(err.status === 404 ? 'This room does not exist or was deleted.' : err.message));
    return () => {
      document.title = 'CodeSync';
    };
  }, [roomId]);

  // Follow language and run-output changes made by anyone in the room.
  useEffect(() => {
    if (!collab) return;
    const meta = collab.doc.getMap<string>('meta');
    const run = collab.doc.getMap<SharedRun | RunningState | null>('run');
    const onMeta = () => {
      const lang = meta.get('language') as Language | undefined;
      if (lang) setLanguage(lang);
      setStdin(meta.get('stdin') ?? '');
    };
    const onRun = () => {
      setLastRun((run.get('last') as SharedRun | undefined) ?? null);
      const running = run.get('running') as RunningState | null | undefined;
      // Ignore a stale "running" flag left by someone who closed their tab mid-run.
      setRunningBy(running && Date.now() - running.at < 60_000 ? running.by : null);
    };
    meta.observe(onMeta);
    run.observe(onRun);
    onMeta();
    onRun();
    return () => {
      meta.unobserve(onMeta);
      run.unobserve(onRun);
    };
  }, [collab]);

  // First visit to a brand-new room: the owner seeds starter code once.
  useEffect(() => {
    if (!collab || !synced || !room || !user || room.ownerId !== user.id) return;
    const meta = collab.doc.getMap<string | boolean>('meta');
    if (meta.get('initialized')) return;
    collab.doc.transact(() => {
      const text = collab.doc.getText('code');
      if (text.length === 0) {
        text.insert(0, LANGUAGES.find((l) => l.id === room.language)?.starter ?? '');
      }
      meta.set('initialized', true);
    });
  }, [collab, synced, room, user]);

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    collab?.doc.getMap('meta').set('language', lang);
    api.updateRoom(roomId, { language: lang }).catch(() => {});
  };

  const runnable = LANGUAGES.find((l) => l.id === language)?.runnable ?? false;

  const changeStdin = (value: string) => {
    setStdin(value);
    collab?.doc.getMap('meta').set('stdin', value);
  };

  const run = useCallback(async () => {
    if (!collab || !runnable || runningBy) return;
    const runMap = collab.doc.getMap('run');
    const by = user?.name ?? 'Someone';
    const code = collab.doc.getText('code').toString();
    // HTML and CSS don't execute on the server: everyone in the room gets a live preview.
    if (language === 'html' || language === 'css') {
      const html = language === 'css' ? cssPreviewPage(code) : code;
      runMap.set('last', { by, at: Date.now(), language: languageLabel(language), durationMs: 0, timedOut: false, logs: [], html } satisfies SharedRun);
      return;
    }

    runMap.set('running', { by, at: Date.now() } satisfies RunningState);

    let logs: SharedRun['logs'];
    let durationMs = 0;
    let timedOut = false;
    try {
      // Every language runs on the server, in an isolated sandbox.
      const { result } = await api.runCode(roomId, language, code, stdin);
      logs = toLogs(result);
      durationMs = result.durationMs;
      timedOut = result.timedOut;
    } catch (err) {
      if (err instanceof ApiError && err.status === 503 && language === 'javascript') {
        // Runner offline: JavaScript can still run locally in a browser sandbox.
        const local = await runJavaScript(code);
        logs = [{ level: 'info', text: 'Server runner offline, ran in your browser instead.' }, ...local.logs];
        durationMs = local.durationMs;
        timedOut = local.timedOut;
      } else {
        logs = [{ level: 'error', text: err instanceof Error ? err.message : 'Run failed' }];
      }
    }

    collab.doc.transact(() => {
      runMap.set('last', { by, at: Date.now(), language: languageLabel(language), durationMs, timedOut, logs } satisfies SharedRun);
      runMap.set('running', null);
    });
  }, [collab, runnable, runningBy, user, roomId, language, stdin]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy this link:', window.location.href);
    }
  };

  if (loadError) {
    return (
      <main className="center">
        <div className="card">
          <h2>Can’t open room</h2>
          <p className="muted">{loadError}</p>
          <Link className="btn btn-primary" to="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="editor-page">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand" aria-label="Back to dashboard">
            <span className="brand-mark">{'</>'}</span>
          </Link>
          <span className="room-title">{room?.name ?? 'Loading…'}</span>
          <select
            className="select-sm"
            value={language}
            onChange={(e) => changeLanguage(e.target.value as Language)}
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="topbar-right">
          <PresenceBar peers={peers} status={status} />
          <button className="btn btn-ghost" onClick={copyLink}>
            {copied ? 'Copied!' : 'Share link'}
          </button>
          <button className="btn btn-primary" onClick={run} disabled={!runnable || Boolean(runningBy)} title="Ctrl+Enter">
            {runningBy ? 'Running…' : 'Run ▶'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <div className="editor-pane">
          {collab && synced ? (
            <CodeEditor
              ytext={collab.doc.getText('code')}
              awareness={collab.provider.awareness}
              language={language}
              onRun={run}
            />
          ) : (
            <div className="center muted">Connecting to room…</div>
          )}
        </div>
        <OutputPanel
          run={lastRun}
          runningBy={runningBy}
          runnable={runnable}
          languageLabel={languageLabel(language)}
          stdin={stdin}
          onStdinChange={changeStdin}
        />
      </div>
    </div>
  );
}
