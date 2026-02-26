FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ openssl

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8080

# Start server
CMD ["npm", "start"]
