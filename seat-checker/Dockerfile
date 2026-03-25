FROM node:20-bookworm

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci

# Install Playwright + Chromium with all system dependencies
RUN npx playwright install --with-deps chromium

# Copy source and build Next.js
COPY . .
RUN npx next build

EXPOSE 3000

CMD ["npm", "start"]
