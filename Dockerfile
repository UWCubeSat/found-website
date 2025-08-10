FROM ubuntu:latest

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=18.20.4

# Update package lists and install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    python3 \
    python3-pip \
    python3-dev \
    python3-numpy \
    python3-opencv \
    python3-matplotlib \
    python3-scipy \
    python3-pil \
    build-essential \
    libstdc++6 \
    libc6 \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Install Python dependencies (using system packages to avoid pip issues)
# Additional pip packages if needed
RUN python3 -c "import sys; print(sys.version)" && \
    python3 -c "import pip; print('pip is available')" || echo "pip check failed"

# Copy application files
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3000

# Set environment variable for production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
