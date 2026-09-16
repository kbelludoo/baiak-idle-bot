FROM oven/bun:1-debian

# Instala o Chromium e fontes mínimas necessárias
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

# Copia arquivos de dependência e instala via Bun
COPY package.json tsconfig.json ./
RUN bun install --production

# Copia o código-fonte em TypeScript
COPY src/ ./src/

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=8080
ENV HOST=0.0.0.0
ENV USER_DATA_DIR=/app/data/chrome_profile

EXPOSE 8080

# Execução direta em memória RAM (JIT) com o Bun
CMD ["bun", "run", "src/index.ts"]
