FROM oven/bun:1-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY bot-ts/package.json bot-ts/bun.lock ./
RUN bun install --production --frozen-lockfile

COPY bot-ts/src/ ./src/
COPY bot/*.js ./runtime/
COPY bot/engine_hunts.json ./runtime/engine_hunts.json

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=8080
ENV HOST=0.0.0.0
ENV USER_DATA_DIR=/app/data/chrome_profile
ENV BAIAK_RUNTIME_DIR=/app/runtime

EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
