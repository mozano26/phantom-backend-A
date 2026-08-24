FROM node:20-slim

# Install Playwright system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libxshmfence1 fonts-liberation wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# Install Playwright browser
RUN npx playwright install chromium

# Copy app code
COPY . .

# Create data directory
RUN mkdir -p data

# Expose port
ENV PORT=3000
EXPOSE 3000

# Start
CMD ["node", "server.js"]
