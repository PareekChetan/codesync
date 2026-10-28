# Putting CodeSync on Your Resume

## Project entry (pick 3–4 bullets)

**CodeSync: Real-time Collaborative Code Editor** | React, TypeScript, Node.js, WebSockets, Yjs (CRDT), Redis, PostgreSQL, Docker, Nginx, Linux
[Live demo](https://your-url) · [GitHub](https://github.com/PareekChetan/codesync)

- Built a Google-Docs-style collaborative code editor with live cursors and presence, using **CRDTs (Yjs)** for conflict-free concurrent editing and offline edits that merge on reconnect.
- Designed a **horizontally scalable WebSocket backend**: stateless Node.js instances behind Nginx relay updates via **Redis pub/sub**, with a state-vector handshake so late-joining instances recover unsaved edits.
- Load-tested **200 concurrent clients across 2 instances** at ~4,000 updates/s with **p95 end-to-end latency of 35 ms** and 100% document convergence.
- Implemented **merge-based persistence to PostgreSQL** (row lock + CRDT merge) with debounced writes, eliminating lost updates from concurrent saves and cutting writes ~300x versus per-keystroke saves.
- Built a **sandboxed code-execution service** for Java, Python, C++, Go, JS and TS: unprivileged processes under `prlimit` in a read-only, capability-dropped container with **no network access**, CPU/memory/time/output limits, fork-bomb protection and a bounded job queue with backpressure.
- Secured the system with JWT auth checked during the WebSocket upgrade, per-connection token-bucket rate limiting, per-user run limits, bcrypt and Zod validation.
- Wrote **41 automated tests** (multi-instance sync, sandbox escape attempts, resource limits); deployed with Docker Compose, Caddy (auto-HTTPS) and GitHub Actions CI.

### Important

1. **Re-run the load test yourself** and use *your* numbers. Never put a number on your resume you can't reproduce in front of an interviewer.
2. The "~300x fewer writes" figure is an estimate (a 2-second debounce versus saving each keystroke of fast typing). Measure it on your setup, or rephrase as "debounced writes".
3. **Deploy it.** A working link is worth more than any bullet point. See `DEPLOYMENT.md`.
4. **Add at least one feature yourself** from `ROADMAP.md`. Interviewers can tell when someone didn't build what they're presenting; extending it is how you make it genuinely yours.
5. Record a 60-second demo video: two browser windows side by side, typing in both, then running code.

## Talking about it

When asked "tell me about a project", use the pitch in `INTERVIEW_GUIDE.md`, then mention one real problem you hit. Real examples from building this:
- The dashboard bundle was 1 MB because a shared "languages" module imported every CodeMirror grammar; splitting it cut the first load to ~86 KB gzipped.
- After sign-up, users were sent to the dashboard instead of the room link they opened, because two redirects raced. Fixed by deriving the redirect in one place (the login route).
- A naive "last write wins" save could lose edits when two instances save the same room; fixed with a row lock + CRDT merge.
