# Roadmap: Make It Yours

Pick at least one of these and build it yourself. Each one is a strong interview story on its own. Rough difficulty is in brackets.

## High impact

1. **Version history** [medium]
   Every N minutes (or on demand), store a snapshot `(room_id, version, state, created_at)`. Add a history panel to preview and restore a version. Restoring = compute the diff and apply it as a new edit, so collaborators aren't disrupted.

2. **Viewer vs editor permissions** [medium]
   Add a `viewer` role. In `wsServer.ts`, pass the role to the room; in `room.ts`, for viewers, ignore sync updates (still allow awareness so they can be seen). Add a "share as read-only" link.

3. **One-time WebSocket tickets** [easy]
   `POST /api/ws-ticket` returns a random 30-second, single-use ticket stored in Redis (`SET ticket:<id> userId EX 30 NX`). The client connects with `?ticket=` instead of the JWT. Removes JWTs from URLs and logs.

4. **Test cases for problems** [medium]
   Let the room owner add hidden test cases (input + expected output). "Submit" runs the code against all of them in the runner and shows pass/fail per case, like LeetCode. Great DSA-interview tie-in.

5. **Stronger per-run isolation** [hard]
   Run each program with `nsjail` or inside gVisor (`runsc`) so every run gets its own namespaces. Benchmark the start-up overhead versus the current design.

## Nice to have

6. **Chat panel per room** using a `Y.Array` of messages [easy]
7. **Follow mode**: click an avatar to scroll to that person's cursor [easy]
8. **AI assist**: explain selected code or suggest a fix, with a rate limit per user [medium]
9. **Playwright end-to-end tests in CI**: two browser contexts editing the same room [medium]
10. **Grafana dashboard** for the Prometheus metrics, added to docker-compose [easy]
11. **OAuth sign-in** with GitHub [medium]
12. **Email invites** to a room [easy]
13. **Shard Redis by room ID** and benchmark the difference [hard]

## How to present additions

In the README, add a short "What I added" section: the problem, your design, the trade-off you chose, and a number (latency, size, test count) where possible.
