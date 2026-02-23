# ============================================================
# Stage 1: deps — install ALL dependencies + native compilation
# ============================================================
FROM node:20-slim AS deps

WORKDIR /app

# Build tools needed for canvas and sharp native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install ALL deps (including dev) — needed for TypeScript compilation
# postinstall runs `prisma generate` automatically
RUN npm ci

# ============================================================
# Stage 2: build — compile TypeScript
# ============================================================
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src/

# Compile TypeScript → dist/
# NOTE: We do NOT run prisma migrate deploy here (needs live DB)
RUN npx tsc -p .

# ============================================================
# Stage 3: runtime — lean final image
# ============================================================
FROM node:20-slim AS runtime

WORKDIR /app

# Runtime system dependencies:
# - LibreOffice (PPTX→PDF conversion via libreoffice-convert npm package)
# - Runtime libs for canvas and sharp
# - curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    # LibreOffice — only what we need (not the full meta-package)
    libreoffice-core \
    libreoffice-writer \
    libreoffice-impress \
    libreoffice-calc \
    # Runtime libs for canvas
    libcairo2 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libgif7 \
    librsvg2-2 \
    # Runtime libs for sharp
    libvips42 \
    # Utilities
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodeuser

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist/

# Copy production node_modules (includes Prisma client from postinstall)
COPY --from=build /app/node_modules ./node_modules/

# Copy Prisma schema (needed for prisma migrate deploy at runtime)
COPY --from=build /app/prisma ./prisma/

# Copy package.json (needed by Node.js for module resolution)
COPY package.json ./

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create temp directory for LibreOffice PDF processing
RUN mkdir -p /tmp/libreoffice-work && chown nodeuser:nodejs /tmp/libreoffice-work

# Switch to non-root user
USER nodeuser

# Expose API port (only used by the api container, not worker)
EXPOSE 4000

# Default CMD is the API server
# Worker overrides this in docker-compose.yml
CMD ["node", "dist/index.js"]
