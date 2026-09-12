#!/usr/bin/env bash
# ==============================================================================
# SAMARTH AI — Turnkey AWS EC2 Production Deployment Script
# 
# Supported OS: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS
# Target Arch: x86_64 / arm64 (t3.medium / t3.large recommended)
#
# Usage:
#   chmod +x scripts/deploy-ec2.sh
#   sudo ./scripts/deploy-ec2.sh
# ==============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}   🏛️  SAMARTH AI — AWS EC2 Automated Production Deployment        ${NC}"
echo -e "${BLUE}======================================================================${NC}"

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[ERROR] This script must be run as root or with sudo.${NC}"
   echo "Please run: sudo ./scripts/deploy-ec2.sh"
   exit 1
fi

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PROJECT_DIR"
echo -e "${GREEN}[1/6] Working in project directory:${NC} $PROJECT_DIR"

# 2. Configure 4GB Swap Space
if ! swapon --show | grep -q "/swapfile"; then
    echo -e "${YELLOW}[2/6] Configuring 4GB Swap space to protect against memory spikes...${NC}"
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q "/swapfile" /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    echo -e "${GREEN}[OK] 4GB Swap file active.${NC}"
else
    echo -e "${GREEN}[2/6] Swap memory already configured.${NC}"
fi

# 3. Install Docker and Docker Compose (if not installed)
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[3/6] Installing Docker and Docker Compose plugin...${NC}"
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}[OK] Docker installed successfully.${NC}"
else
    echo -e "${GREEN}[3/6] Docker is already installed: $(docker --version)${NC}"
fi

# 4. Verify Environment File (.env)
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${YELLOW}[4/6] Creating .env from .env.example...${NC}"
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)
    sed -i "s/CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING/$JWT_SECRET/g" "$PROJECT_DIR/.env"
    sed -i "s/ENVIRONMENT=development/ENVIRONMENT=production/g" "$PROJECT_DIR/.env"
    sed -i "s/DEBUG=true/DEBUG=false/g" "$PROJECT_DIR/.env"
    
    echo -e "${YELLOW}[ACTION REQUIRED] A new .env was generated with a secure JWT key.${NC}"
    echo -e "${YELLOW}Please ensure MONGODB_URI in '$PROJECT_DIR/.env' points to your MongoDB Atlas cluster.${NC}"
else
    echo -e "${GREEN}[4/6] Existing .env file found.${NC}"
fi

# 5. Build and Launch Containers
echo -e "${BLUE}[5/6] Building and starting production containers...${NC}"
docker compose -f docker-compose.yml -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 6. Check Container Status and Health
echo -e "${BLUE}[6/6] Waiting for services to initialize...${NC}"
sleep 8

docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || curl -s https://ifconfig.me || echo "your-ec2-ip")

echo -e "${GREEN}======================================================================${NC}"
echo -e "${GREEN}   🚀  SAMARTH AI IS NOW LIVE ON AWS EC2!                           ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e "Frontend Portal:      ${BLUE}http://${PUBLIC_IP}/${NC} (Port 80 and 3000)"
echo -e "Backend API / Health: ${BLUE}http://${PUBLIC_IP}:8000/health${NC}"
echo -e "Citizen Portal:       ${BLUE}http://${PUBLIC_IP}/public${NC}"
echo -e "Official Sign In:     ${BLUE}http://${PUBLIC_IP}/login${NC}"
echo -e ""
echo -e "Security Group Checklist:"
echo -e " - Port 80 (HTTP):    Allow from 0.0.0.0/0 (Public Access)"
echo -e " - Port 443 (HTTPS):  Allow from 0.0.0.0/0 (SSL Secure)"
echo -e " - Port 22 (SSH):     Allow from your IP (Management)"
echo -e ""
echo -e "To view live logs:     ${YELLOW}docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f${NC}"
echo -e "To stop the stack:     ${YELLOW}docker compose -f docker-compose.yml -f docker-compose.prod.yml down${NC}"
echo -e "${GREEN}======================================================================${NC}"
