# Build stage for Rust
FROM rust:1.70-slim-bullseye as rust-builder
WORKDIR /usr/src/app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Rust project files
COPY rust-sqlite-api/ .

# Build the Rust application
RUN cargo build --release

# Build stage for Node.js
FROM node:18-bullseye-slim as node-builder
WORKDIR /usr/src/app

COPY ui/package*.json .
RUN npm install

# Copy UI project files
COPY ui/ .

# Build the UI  
RUN npm run build

# Final stage
FROM debian:bullseye-slim
WORKDIR /app

# Install necessary runtime dependencies
RUN apt-get update && apt-get install -y \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts from build stages
COPY --from=rust-builder /usr/src/app/target/release/rust-sqlite-api .
COPY --from=node-builder /usr/src/app/dist ui/dist

# Create a directory for the database
RUN mkdir -p /app/data

# Set environment variables
ENV DATABASE_PATH=/app/data/windsurf.db

# Expose the port
EXPOSE 8080

# Run the application
CMD ["./rust-sqlite-api", "--database-path", "/app/data/windsurf.db"]