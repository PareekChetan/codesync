# Deploy CodeSync Live (step by step)

You'll rent a small Linux server, copy the project to it, and run one script. At the end you get a public **https://** link where everything works: login, live editing, cursors, and running Java / Python / C++ / Go / JS / TS.

**Why a server (VM) and not Vercel/Netlify/Render?** The code runner needs real compilers and container-level isolation, and the app needs long-lived WebSocket connections. Free "serverless" hosts can't do that. One VM running `docker compose` can, and it's exactly how you'd describe a real deployment in an interview.

**What you need:** a server with **Ubuntu 22.04 or 24.04**, at least **2 GB RAM** (4 GB is comfortable), and ports **22, 80 and 443** open.

---

## Step 1: Get a server (pick one)

Free offers change often. Check the provider's page before signing up.

### Option A: Azure for Students (no credit card)
Gives a yearly credit to full-time students who sign up with a college email.
1. Go to https://azure.microsoft.com/free/students and sign in with your **college email**.
2. In the Azure portal: **Create a resource → Virtual machine**.
   - Image: **Ubuntu Server 24.04 LTS**
   - Size: a **2 vCPU / 4 GB** size (e.g. B2s) runs everything smoothly; a 2 GB size works too but builds slower and uses credit more slowly. Check the monthly cost shown on the page against your credit.
   - Authentication: **SSH public key**, username `azureuser`. Download the `.pem` key when asked.
   - Inbound ports: allow **SSH (22), HTTP (80), HTTPS (443)**.
3. Click **Review + create → Create**. Copy the VM's **Public IP address**.

### Option B: Oracle Cloud Always Free
Free indefinitely within limits. In mid-2026 Oracle reduced the free Ampere (ARM) allowance to 2 OCPUs and 12 GB RAM, which is still plenty for CodeSync. Sign-up asks for a card for verification.
1. Sign up at https://www.oracle.com/cloud/free/.
2. **Compute → Instances → Create instance**.
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **Ampere (VM.Standard.A1.Flex)**, 2 OCPU, 12 GB (or whatever the free tier currently allows)
   - Download the private SSH key.
3. Open ports 80 and 443: on the instance page click the **subnet → Security List → Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination port `80`; repeat for `443`.
4. Oracle's Ubuntu image also has a local firewall. After you log in (Step 2), run:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

### Option C: Any other VPS
DigitalOcean, AWS Lightsail/EC2, Hetzner, Google Cloud etc. all work. The GitHub Student Developer Pack (https://education.github.com/pack) often includes cloud credits. Choose Ubuntu 24.04, ≥ 2 GB RAM, open ports 22/80/443.

---

## Step 2: Connect to the server from Windows

Open **PowerShell** and go to the folder with your downloaded key:

```powershell
cd $HOME\Downloads
ssh -i .\your-key.pem azureuser@YOUR_SERVER_IP
```

- Use `ubuntu@YOUR_SERVER_IP` for Oracle and AWS.
- Type `yes` when asked about the fingerprint.
- If you get **"UNPROTECTED PRIVATE KEY FILE"**, fix the key's permissions once, then retry:
  ```powershell
  icacls .\your-key.pem /inheritance:r
  icacls .\your-key.pem /grant:r "$($env:USERNAME):(R)"
  ```

You're in when the prompt looks like `azureuser@your-vm:~$`.

---

## Step 3: Put the project on the server

**Recommended: via GitHub** (you need it on GitHub for your resume anyway).

1. On your PC, create a new repository on https://github.com/new called `codesync` (public).
2. In PowerShell, inside the project folder (`...\codesync\codesync`):
   ```powershell
   git init
   git add .
   git commit -m "CodeSync: real-time collaborative code editor"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/codesync.git
   git push -u origin main
   ```
   (Install Git from https://git-scm.com if `git` isn't recognized.)
3. On the server:
   ```bash
   git clone https://github.com/YOUR_USERNAME/codesync.git
   cd codesync
   ```

**Alternative: copy the zip directly.** In a new PowerShell window on your PC:
```powershell
scp -i $HOME\Downloads\your-key.pem $HOME\Downloads\codesync.zip azureuser@YOUR_SERVER_IP:~
```
Then on the server: `sudo apt-get install -y unzip && unzip codesync.zip && cd codesync`

---

## Step 4: Deploy

On the server, inside the `codesync` folder:

```bash
bash deploy.sh
```

The script installs Docker, generates secret passwords into `.env`, builds everything and turns on HTTPS. The first run takes **5–15 minutes** (it downloads the compilers). At the end it prints:

```
==> Live at https://20-123-45-67.sslip.io
```

Open that link. That's your live site. 🎉

**About the address:** with no domain, the script uses `YOUR-IP.sslip.io`, a free service that points to your IP, and Caddy gets a real HTTPS certificate for it. To use your own domain (e.g. `codesync.yourname.dev`):
1. At your domain registrar, create an **A record** pointing to your server IP.
2. On the server: `rm .env && DOMAIN=codesync.yourname.dev bash deploy.sh`
   (Do this before you have real users: deleting `.env` also creates a new database password, so if the database already exists also run `sudo docker compose down -v` first, which **erases all data**.)

---

## Step 5: Check everything works

1. Open the link, sign up, create a **Java** room, press **Run ▶**: you should see `Hello from Java!`.
2. Type numbers into **Input**, read them with `Scanner`, run again.
3. Open the same room link on your phone (sign up as a second user) and type on both.
4. Try Python, C++, Go. The first Java/Go run after a restart can take a few seconds while caches warm up.

---

## Everyday commands (run on the server, in the `codesync` folder)

```bash
# Alias to save typing
alias dc='sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml'

dc ps                      # status of all services
dc logs -f api1 runner     # live logs
dc restart                 # restart everything
dc down                    # stop (data is kept)

# Deploy new code after pushing to GitHub:
git pull && bash deploy.sh

# Backup the database:
dc exec -T postgres pg_dump -U codesync codesync > backup-$(date +%F).sql
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Script ends with "isn't answering yet" | Ports 80/443 aren't open. Check the cloud firewall (Azure: Networking tab; Oracle: Security List **and** the iptables commands above). Then `dc logs caddy`. |
| Build stops with "killed" or "out of memory" | The VM is too small. Use ≥ 2 GB RAM (the script adds swap, but 1 GB machines struggle building the runner). |
| Site loads but Run says "not available" | `dc logs runner`. It's usually still building or restarting; `dc up -d runner` to start it. |
| "Too many requests" on login | That's the brute-force protection (20 attempts per 15 min per IP). Wait, or `dc restart api1 api2`. |
| Changed code but the site didn't change | Run `git pull && bash deploy.sh` again. It rebuilds what changed. |

---

## Costs and safety

- **Stop paying when you're done:** on credit-based plans, the VM uses credit while it's running. Stop or delete it from the cloud portal when you no longer need it (keep it running while you're applying for jobs, though).
- **Secrets:** `.env` holds your passwords. It's in `.gitignore`. Never commit it.
- **Abuse:** the code runner has no internet access, strict CPU/memory/time limits, and a per-user rate limit of 20 runs a minute, so a public link is reasonably safe for a portfolio project.
