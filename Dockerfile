FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsup.config.ts tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev

# REST API port (default: 3001)
EXPOSE 3001
# WebSocket relay port (default: 3002)
EXPOSE 3002

ENV NODE_ENV=production \
    REST_PORT=3001 \
    RELAY_PORT=3002

CMD ["node", "dist/relay/relay-server.js"]
