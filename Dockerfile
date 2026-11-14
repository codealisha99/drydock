# Showcase image for the hosted demo: the API serves recorded runs and the built UI.
# No Docker socket, no sandbox image and no repo store are used in this mode.
FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build
ENV DRYDOCK_MODE=showcase DRYDOCK_HOST=0.0.0.0 NODE_ENV=production
USER node
# Railway injects PORT; fall back to 4100 locally.
CMD ["sh", "-c", "DRYDOCK_PORT=${PORT:-4100} exec node --disable-warning=ExperimentalWarning --import tsx src/server/index.ts"]
