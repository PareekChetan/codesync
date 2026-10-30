# Deploy CodeSync Free on Render (no server needed)

A free, always-available link where everything works, including running Java, Python, C++, Go, JS and TS.

```
Browser ──▶ Render (one free web service: website + API + WebSockets)
               ├──▶ Neon        (free PostgreSQL: users, rooms, documents)
               └──▶ Judge0 API  (runs code, via RapidAPI's free plan)
```

How it differs from the full `docker-compose` setup:

| | Full setup (VM) | Render free |
|---|---|---|
| API instances | 2 behind Nginx | 1 |
| Redis | Yes (cross-instance sync) | Not needed (single instance) |
| Code runner | Own sandboxed runner service | Judge0 API |
| Always on | Yes | Sleeps after 15 min idle; first visit takes about a minute |

The code is the same; it switches by environment variables (`REDIS_URL` empty → single-instance mode, `RUNNER_MODE=judge0`, `STATIC_DIR` → serve the website). The root `Dockerfile` builds this single-service image.

---

## Step 1: Free database on Neon (5 min)

1. Go to https://neon.tech and **Sign up with GitHub**.
2. Create a project: name `codesync`, Postgres version 16 or newer, region **AWS Asia Pacific (Singapore)** (closest to India; Render's Singapore region is next to it).
3. On the project dashboard click **Connect**.
4. **Turn OFF "Connection pooling"**. You need the *direct* connection (the host must **not** contain `-pooler`).
5. Copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-something-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   Keep it for Step 3. Tables are created automatically on first start.

## Step 2: Free Judge0 API key on RapidAPI (5 min)

1. Go to https://rapidapi.com/judge0-official/api/judge0-ce and sign up (Google/GitHub login works).
2. Open the **Pricing** tab and subscribe to the **Basic** plan (the free one). Check its daily request limit there. Each Run uses one request.
3. Open the **Endpoints** tab. In the code snippet on the right, copy the value of **`X-RapidAPI-Key`**.

## Step 3: Deploy on Render (10 min)

1. Go to https://render.com and **Sign up with GitHub**.
2. **New → Web Service** → connect GitHub → pick **PareekChetan/codesync**.
3. Settings:
   - **Name:** `codesync-chetan` (this becomes `https://codesync-chetan.onrender.com`)
   - **Region:** Singapore
   - **Branch:** `main`
   - **Language / Runtime:** **Docker** (it finds the root `Dockerfile`)
   - **Instance type:** **Free**
4. **Environment variables** (Add Environment Variable):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from Step 1 |
   | `JWT_SECRET` | click **Generate** (or any 40+ random characters) |
   | `JUDGE0_KEY` | the RapidAPI key from Step 2 |
   | `CORS_ORIGIN` | `https://codesync-chetan.onrender.com` (your URL) |

   (`REDIS_URL`, `RUNNER_MODE` and `STATIC_DIR` are already set in the Dockerfile.)
5. Under **Advanced**, set **Health Check Path** to `/healthz`.
6. Click **Create Web Service**. The first build takes about 5–10 minutes. When the log shows `CodeSync server listening` and the status is **Live**, open your URL.

## Step 4: Check it

1. Sign up, create a **Java** room, press **Run ▶**. You should see `Hello from Java!`.
2. Open the room link on your phone (as a second user) and type on both.
3. Every `git push` to `main` redeploys automatically.

## Troubleshooting

| Problem | Fix |
|---|---|
| Deploy log: `Invalid environment configuration` | A variable is missing or `JWT_SECRET` is under 16 characters. |
| Deploy log: database / SSL / `ECONNREFUSED` errors | Check `DATABASE_URL`: direct connection (no `-pooler`), ends with `?sslmode=require`. If it has `&channel_binding=require`, remove that part. |
| Run says "Daily run limit reached" | The Judge0 free quota is used up for today; it resets daily. Editing still works. |
| Run says "Code runner failed (401/403)" | Wrong `JUDGE0_KEY`, or you didn't subscribe to the Basic plan. |
| Site takes about a minute to open | Normal on the free plan after 15 min idle. Say "first load may take a minute" next to the link. |
| Render asks for a card | Render sometimes asks for verification on new accounts. Try again later, or use the Azure/VM route in `DEPLOYMENT.md`. |
