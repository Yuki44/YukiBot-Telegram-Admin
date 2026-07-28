# Debian (glibc) base — onnxruntime-node ships glibc-only Linux binaries that
# abort the process on Alpine/musl ("Error loading shared library ld-linux-x86-64.so.2").
FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Copy root package files first for better layer caching
COPY package.json package-lock.json ./

# Install root dependencies (including dev for build)
RUN npm ci

# Copy web package files separately for cached web installs
COPY web/package.json web/package-lock.json* ./web/
RUN npm run install:web

# Copy source code
COPY . .

# Build web app (tsc + vite build) then bot (tsc).
# Web bundle ends up in web/dist/ and is served by Express.
RUN npm run build

# Drop dev dependencies and the web node_modules (not needed at runtime — Express
# serves static files from web/dist/).
RUN npm prune --production
RUN rm -rf web/node_modules

# Start the bot (which also boots the Express API server)
CMD ["npm", "start"]
