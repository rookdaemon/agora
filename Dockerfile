# Multi-stage build for Agora relay
# Runs both WebSocket relay (port 3001) and REST API (port 3002)

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY package.json ./

ENV PORT=3001
EXPOSE 3001 3002

# Start the relay via the CLI
CMD ["node", "dist/cli.js", "relay", "--port", "3001"]
