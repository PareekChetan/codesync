# Code runner image: Node.js service + compilers/interpreters for each language.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 g++ openjdk-17-jdk-headless golang-go ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Unprivileged user that every submitted program runs as.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin sandbox

# Pre-warm the Go build cache for common standard-library packages, so the first
# Go run takes ~1s instead of ~7s. Each run gets a private copy (no cache poisoning).
RUN mkdir -p /opt/gowarm && cd /opt/gowarm \
 && printf 'package main\nimport (\n"bufio"\n"container/heap"\n"fmt"\n"math"\n"os"\n"sort"\n"strconv"\n"strings"\n)\nvar _ = heap.Init\nfunc main(){ r := bufio.NewReader(os.Stdin); _ = r; fmt.Println(math.Pi, sort.IntsAreSorted(nil), strconv.Itoa(1), strings.ToUpper("a")) }\n' > main.go \
 && GOCACHE=/opt/gocache GOPATH=/tmp/gopath go build -o /tmp/warm main.go \
 && rm -rf /opt/gowarm /tmp/warm /tmp/gopath && chmod -R a+rX /opt/gocache

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=5050 \
    SANDBOX_UID=10001 \
    SANDBOX_GID=10001 \
    GO_CACHE_TEMPLATE=/opt/gocache \
    WORK_ROOT=/tmp

# The service starts as root ONLY so it can drop each program to the sandbox user.
# docker-compose.yml removes every other capability and isolates the network.
EXPOSE 5050
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://localhost:5050/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
