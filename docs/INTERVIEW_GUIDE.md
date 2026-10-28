# Interview Guide: Defend Every Line

Interviewers will open your GitHub, pick something, and ask "why?". This guide covers the questions you will get about CodeSync. **Read the code alongside it.** You must be able to explain these answers in your own words, without notes.

---

## 1. The 60-second pitch

> "CodeSync is a real-time collaborative code editor, like Google Docs for code. The interesting part is the backend. Edits are merged with a CRDT, so concurrent typing never conflicts and offline edits merge on reconnect. Clients connect over WebSockets, and I made the server horizontally scalable: multiple instances sit behind Nginx and relay updates to each other through Redis pub/sub, so two users in the same room can be on different servers. Documents are persisted to Postgres with debounced, merge-based saves. I load-tested it at 200 concurrent clients across two instances with p95 latency around 35 ms, and I have integration tests that spin up two real servers to verify cross-instance sync."

Then stop and let them pick a thread.

---

## 2. CRDTs and conflict resolution

**Q: What happens when two people type at the same position at the same time?**
Each character Yjs inserts gets a unique ID (client ID + counter) and remembers its left and right neighbours at insertion time. When two inserts target the same spot, Yjs orders them by a deterministic rule (comparing client IDs). Every replica applies the same rule, so they all end up with the same text, no matter what order the updates arrive in.

**Q: Why a CRDT and not Operational Transformation (what Google Docs uses)?**
OT transforms each operation against concurrent ones and usually needs a central server to define a single order. CRDTs are designed so operations commute: apply them in any order and you get the same result. That gives me three things: offline editing that merges cleanly, no single ordering server (which is exactly what lets me run several instances), and simpler server logic. The trade-off is memory: CRDTs keep metadata about deleted content (tombstones). Yjs mitigates this with garbage collection and compact encoding.

**Q: What are the CRDT properties that matter?**
Merges are commutative (order doesn't matter), associative (grouping doesn't matter) and idempotent (applying the same update twice is harmless). Idempotency is why duplicate Redis messages can't corrupt a document.

**Q: What is a state vector?**
A map of `clientId → highest clock seen`. It summarises "what I already have" in a few bytes. A peer can compute exactly the updates I am missing with `Y.encodeStateAsUpdate(doc, myStateVector)`. I use it in the client handshake (sync step 1/step 2) and between server instances.

---

## 3. Scaling

**Q: How does it scale horizontally?**
Each instance holds in memory only the rooms that have clients connected to it. When a local client sends an update, the instance broadcasts it to its local clients and publishes it on the Redis channel `codesync:room:<id>`. Other instances holding that room apply it and push it to their clients. Messages carry the sender's instance ID so an instance ignores its own echoes.

**Q: Why not just use sticky sessions (all users in a room go to one server)?**
Sticky sessions are a valid alternative and reduce cross-instance traffic. But they make one hot room a single point of overload, complicate failover (if that instance dies, the whole room disconnects), and need a smarter load balancer. With Redis fan-out, any instance can serve any user, so the load balancer can be simple `least_conn`. In an interview, say both options and the trade-off.

**Q: An instance loads a room after others have been editing. How does it get the unsaved edits?**
After loading the snapshot from Postgres and subscribing to the channel, it publishes a `sync-request` containing its state vector. Every instance holding the room replies with a directed `sync-response` containing only the missing diff, plus the presence states of its local users. See `CollabRoom.init()` and the `sync-request` case in `room.ts`. The integration test "late joiner gets edits that were never saved" proves it.

**Q: Why subscribe BEFORE sending the sync request?**
Otherwise an update published between "I loaded the snapshot" and "I subscribed" would be lost. Subscribing first means anything new arrives on the channel, and the sync response covers everything before it. Duplicates are fine because merges are idempotent.

**Q: What is the bottleneck at 10x or 100x scale?**
- **Redis pub/sub fan-out**: every instance subscribed to a room receives every update. Fine at this scale. Beyond that: shard rooms across Redis nodes (hash room ID → node), or use Redis Streams / Kafka for durability and replay.
- **Large documents in memory**: cap document size, and unload idle rooms (already done).
- **Postgres writes**: already debounced. Next step: batch saves, or move snapshots to object storage (S3) and keep only metadata in Postgres.
- **Single-node limits**: Node.js is single-threaded per process; run one instance per CPU core.

**Q: Redis pub/sub is fire-and-forget. What if a message is dropped?**
Clients and instances re-run the state-vector handshake on reconnect, and the CRDT can always be repaired by exchanging diffs. Persistence is independent of Redis. So a dropped message causes a short delay, not data loss. For stronger guarantees I would move to Redis Streams with consumer acknowledgements.

---

## 4. Persistence

**Q: How and when do you save?**
Debounced: wait for 2 seconds of no edits, but never longer than 10 seconds since the first unsaved edit (`schedulePersist` in `room.ts`). Saves are chained so two never overlap. On shutdown or when the room unloads, it flushes immediately.

**Q: Two instances save the same document at once. Can you lose data?**
No. A naive `UPSERT` (last write wins) could: if instance B's in-memory copy is slightly behind instance A's, B's save could overwrite A's newer edits. Instead, `PostgresDocStore.save` locks the row with `SELECT … FOR UPDATE`, merges the stored state with the new one using `Y.mergeUpdates`, and writes the union. Because CRDT merges are commutative and idempotent, the order of saves no longer matters. There is a unit test for exactly this.

**Q: Why store a binary snapshot instead of every edit?**
Reading a document is then one row lookup instead of replaying thousands of operations. The trade-off is no built-in history; version history is on the roadmap (store periodic snapshots).

**Q: Why is the room ID a random 10-character string and not an auto-increment number?**
Sequential IDs are guessable: someone could iterate `/room/1`, `/room/2`. A random ID from 33 symbols gives about 50 bits of entropy, so links work as unguessable capabilities.

---

## 5. WebSockets and the protocol

**Q: Why WebSockets and not HTTP polling or Server-Sent Events?**
Editing is bidirectional and high-frequency. Polling adds latency and wasted requests; SSE is server-to-client only. WebSockets give a single persistent full-duplex connection with tiny per-message overhead. Messages are binary (Yjs encoding), not JSON, which keeps them small.

**Q: Walk me through what happens when a client connects.**
1. HTTP `GET /ws/<roomId>?token=…` with an `Upgrade` header.
2. During the upgrade, before accepting a socket, the server verifies the JWT, checks the room exists and the per-room limit; otherwise it responds 401/404/429 and closes.
3. The room is loaded (lazily, deduped if several clients join at once). Messages arriving during loading are queued.
4. Server sends sync step 1 (its state vector) and the current presence states.
5. Client replies with sync step 2 (what the server is missing) and its own step 1; the server replies with what the client is missing. Now both are in sync and further edits are streamed as updates.

**Q: Why put the token in the query string? Isn't that a security risk?**
Browsers' WebSocket API cannot set custom headers, so the common options are a query param, a cookie, or a short-lived ticket. Query strings can end up in proxy logs. The production fix is a one-time ticket: the client calls `POST /api/ws-ticket` with its JWT and gets a 30-second single-use ticket for the WebSocket URL. Mention this as a known trade-off and improvement.

**Q: How do you detect dead connections?**
A ping every 30 seconds; if no pong arrives before the next ping, the socket is terminated. Without this, a user whose laptop went to sleep would stay "online" forever.

**Q: How do you stop one client from flooding the server?**
A token bucket per socket (burst 300, refill 100/s), a 1 MB max payload, and a maximum of 50 clients per room per instance. The login endpoint has its own rate limit against brute force.

**Q: How does presence (cursors, who's online) work?**
Yjs "awareness": each client publishes a small ephemeral state (name, colour, cursor). It is not persisted. The server tracks which awareness IDs belong to which socket, so when a socket closes it removes those states and broadcasts the removal (including to other instances). If an instance crashes, clients time out stale states after 30 seconds.

---

## 6. Security

- Passwords hashed with **bcrypt** (cost 10), never stored or logged in plain text (pino redacts them).
- Same error message for "no such user" and "wrong password" to prevent email enumeration.
- All input validated with **Zod**; SQL uses **parameterised queries** (no injection).
- **Helmet** security headers, strict CORS origin, 100 KB JSON body limit.
- The API never runs user code. It forwards jobs to a separate **runner service** (see section 6b).
- Config is validated at boot; the server refuses to start in production with the default JWT secret.

---

## 6b. Running untrusted code (the code runner)

**Q: Users can submit any code. How do you stop them from attacking your server?**
Layers, from the inside out (`runner/src/sandbox.js`, `docker-compose.yml`):
1. **Separate service.** The API never executes code; it forwards `{language, code, stdin}` to the runner over a private Docker network with a shared secret. If the runner is compromised, the API, database and Redis aren't in the same container.
2. **No internet.** The runner sits on a Docker network marked `internal`, so programs can't download malware, mine crypto for long, or attack other sites. It also can't reach Postgres or Redis, which are on a different network.
3. **Unprivileged user.** The service drops every program to uid 10001 before exec, so it can't read the service's files or signal other processes.
4. **prlimit per process:** CPU seconds (SIGXCPU → reported as time limit), max processes (`--nproc`, stops fork bombs), max file size, and virtual memory for Python/C++.
5. **Wall-clock timeout** that SIGKILLs the whole **process group**, catching `sleep` loops and children. When the main program exits, any background processes it left are killed too.
6. **Output cap** (64 KB): a program printing forever is killed once it passes the cap.
7. **Fresh temp directory** per run, deleted afterwards; minimal environment variables.
8. **Container limits:** read-only root filesystem, a size-limited tmpfs for scratch, all Linux capabilities dropped except the few needed to drop privileges, `no-new-privileges`, memory 1 GB, CPU 1.5, 512 pids, and `init` to reap zombie processes.

**Q: Why not start a new Docker container per run (like many judges do)?**
That gives stronger isolation per run, but needs access to the Docker daemon. Mounting the Docker socket into a service is effectively root on the host, which is a bigger risk than the one it solves. Container start-up also adds ~0.5–1s per run. My design isolates the runner *as a whole* in one locked-down container and uses process-level limits inside. For stronger isolation at scale I'd use gVisor or Firecracker microVMs, or nsjail per run.

**Q: Why is RLIMIT_AS (memory) not applied to Java, Go and Node?**
Those runtimes reserve large *virtual* address ranges at startup (far beyond what they actually use), so a virtual-memory cap makes them crash immediately. They're capped with their own flags (`-Xmx256m`, `--max-old-space-size`), and the container's 1 GB hard limit is the backstop.

**Q: What happens when 100 people press Run at once?**
A bounded queue: N jobs run in parallel (N ≈ CPU cores − 1), up to 20 wait, and the rest get HTTP 429 immediately. Each user is also limited to 20 runs per minute at the API. Failing fast keeps latency predictable instead of every run slowing to a crawl. To scale out, add runner replicas behind the API (they're stateless) or move to a real job queue (BullMQ/Redis) with workers.

**Q: How does Java run if the class is called `Solution`, not `Main`?**
Java 11+ single-file source launch (`java Main.java`) compiles in memory and runs the first top-level class with a `main` method, regardless of the file name.

**Q: Why is the Go build fast?**
Go compiles the standard library into a build cache. The Docker image pre-warms that cache, and each run gets a private copy, so the first run is ~1s instead of ~7s and one user's run can't poison another user's cache.

**Q: What if the runner is down?**
The editor keeps working; only Run is affected (the API returns 503). For JavaScript, the browser falls back to a Web Worker: no DOM, cookies or localStorage access, network APIs removed, and killed after 3 seconds.

**Q: How do you know the sandbox actually works?**
17 tests run real attacks against it: infinite loops, sleep loops, output floods, 2 GB allocations, fork bombs, background processes, and reading files from a previous run. CI runs them inside the production image.

---

## 7. Reliability and operations

**Q: What happens on deploy (SIGTERM)?**
`stop()` closes the WebSocket server (clients get close code 1001 and the provider reconnects to another instance), stops the HTTP server, flushes every loaded document to Postgres, then disconnects Redis. A 15-second watchdog forces exit if something hangs.

**Q: Liveness vs readiness?**
`/healthz` = the process is alive (restart it if not). `/readyz` = it can serve traffic (DB and Redis reachable); a load balancer should stop routing to it if not.

**Q: How would you know something is wrong in production?**
Prometheus metrics at `/metrics`: HTTP latency histogram by route, active WebSocket connections, active rooms, messages by type, Redis bridge traffic, and document save duration. Structured JSON logs (pino) tagged with the instance ID. I'd alert on p95 latency, save failures and readiness.

**Q: How do migrations work with two instances starting at once?**
The migration runner takes a Postgres advisory lock, so only one instance migrates; the other waits and then sees the migration already applied. Each migration runs in a transaction.

---

## 8. Frontend

**Q: Why does typing feel instant?**
Edits are applied to the local Yjs doc first and rendered immediately (optimistic local-first). Syncing happens in the background.

**Q: How did you keep the bundle small?**
The editor page (CodeMirror plus 9 language grammars, ~330 KB gzipped) is lazy-loaded with `React.lazy`, so the login and dashboard pages ship only ~86 KB gzipped. I also had to move the grammar imports out of a shared module, because the dashboard importing the language list was pulling every grammar into the main bundle.

**Q: How does undo work with multiple users?**
`Y.UndoManager` tracks only changes from the local client, so Ctrl+Z undoes your edits and never your teammate's.

---

## 9. Testing

**Q: How do you test a real-time distributed system?**
The integration tests start two real server instances in the same process on random ports, sharing a real Redis and Postgres, then connect real `y-websocket` clients (the same library the browser uses). They verify same-instance sync, cross-instance sync, convergence under 100 concurrent random edits from 4 users on 2 instances, presence join/leave across instances, late-joiner catch-up of unsaved edits, persistence and reload, and WebSocket auth rejection. Assertions poll with a timeout because the system is asynchronous. CI runs them against Postgres and Redis service containers.

---

## 10. "What would you do differently / next?"

Good answers show judgement:
- One-time WebSocket tickets instead of JWTs in the query string.
- Per-run isolation with gVisor/nsjail, and a proper job queue for the runner.
- Version history with periodic snapshots and a restore button.
- Room permissions (viewer vs editor), enforced on the server by dropping update messages from viewers.
- Redis Streams for delivery guarantees, or sharding Redis by room for scale.
- End-to-end tests with Playwright in CI.

## Practice

Explain each of these out loud, then draw them on paper:
1. The architecture diagram from memory.
2. The path of one keystroke from Browser A to Browser B on another instance.
3. The late-joiner handshake.
4. Why a merge-based save can't lose data, and how a plain upsert could.
