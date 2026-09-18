FROM oven/bun:1-debian
WORKDIR /app
COPY package.json server.ts index.html ./
EXPOSE 8081
CMD ["bun", "run", "server.ts"]
