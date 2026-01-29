# AWS Deployment Guide for Microservices Backend

## Option 1: EC2 (Single Instance - Good for Learning/Dev)

### Step 1: Launch EC2 Instance
1. Go to AWS Console → EC2 → Launch Instance
2. Choose **Amazon Linux 2023** or **Ubuntu 22.04**
3. Instance type: **t2.micro** (free tier) or **t3.small** for better performance
4. Create/select a key pair for SSH
5. Security Group - Allow these ports:
   - SSH (22) - Your IP
   - HTTP (80) - Anywhere
   - Custom TCP (8001, 8002, 8003) - Anywhere (or use Nginx reverse proxy)

### Step 2: Connect & Install Dependencies
```bash
# Connect to your instance
ssh -i your-key.pem ec2-user@your-ec2-public-ip

# Update system
sudo yum update -y  # Amazon Linux
# OR
sudo apt update && sudo apt upgrade -y  # Ubuntu

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs  # Amazon Linux
# OR
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs  # Ubuntu

# Install Git
sudo yum install -y git  # Amazon Linux
sudo apt install -y git  # Ubuntu

# Install PM2 (Process Manager)
sudo npm install -g pm2
```

### Step 3: Clone & Setup Project
```bash
# Clone your repo (upload to GitHub first)
git clone https://github.com/YOUR_USERNAME/microservices-backend.git
cd microservices-backend

# Install dependencies for each service
cd customer && npm install && cd ..
cd products && npm install && cd ..
cd shopping && npm install && cd ..
```

### Step 4: Create Production Environment Files
```bash
# Create .env files for each service with your cloud credentials
# Customer service
cat > customer/.env << 'EOF'
APP_SECRET=your-production-secret-key
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/customer_db
MSG_QUEUE_URL=amqps://user:pass@your-rabbitmq-host/vhost
PORT=8001
EOF

# Products service
cat > products/.env << 'EOF'
APP_SECRET=your-production-secret-key
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/products_db
MSG_QUEUE_URL=amqps://user:pass@your-rabbitmq-host/vhost
PORT=8002
EOF

# Shopping service
cat > shopping/.env << 'EOF'
APP_SECRET=your-production-secret-key
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/shopping_db
MSG_QUEUE_URL=amqps://user:pass@your-rabbitmq-host/vhost
PORT=8003
EOF
```

### Step 5: Start Services with PM2
```bash
# Start all services
cd customer && pm2 start src/index.js --name customer-service && cd ..
cd products && pm2 start src/index.js --name products-service && cd ..
cd shopping && pm2 start src/index.js --name shopping-service && cd ..

# Save PM2 process list & enable startup
pm2 save
pm2 startup

# View logs
pm2 logs

# Monitor
pm2 monit
```

### Step 6: Install Nginx (Reverse Proxy)
```bash
sudo yum install -y nginx  # Amazon Linux
sudo apt install -y nginx  # Ubuntu

# Create Nginx config
sudo tee /etc/nginx/conf.d/microservices.conf << 'EOF'
upstream customer {
    server 127.0.0.1:8001;
}
upstream products {
    server 127.0.0.1:8002;
}
upstream shopping {
    server 127.0.0.1:8003;
}

server {
    listen 80;
    server_name your-domain.com;  # Or use EC2 public IP

    location /customer/ {
        rewrite ^/customer/(.*) /$1 break;
        proxy_pass http://customer;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /products/ {
        rewrite ^/products/(.*) /$1 break;
        proxy_pass http://products;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /shopping/ {
        rewrite ^/shopping/(.*) /$1 break;
        proxy_pass http://shopping;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## Option 2: ECS Fargate (Production-Ready Containers)

### Step 1: Push Docker Images to ECR
```bash
# Install AWS CLI and configure
aws configure  # Enter your AWS credentials

# Create ECR repositories
aws ecr create-repository --repository-name microservices/customer
aws ecr create-repository --repository-name microservices/products
aws ecr create-repository --repository-name microservices/shopping

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push images
docker build -t microservices/customer ./customer
docker tag microservices/customer:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/microservices/customer:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/microservices/customer:latest

# Repeat for products and shopping
```

### Step 2: Create ECS Cluster
1. Go to AWS Console → ECS → Create Cluster
2. Choose **AWS Fargate** (serverless)
3. Name: `microservices-cluster`

### Step 3: Create Task Definitions
Create a task definition for each service with:
- Container image: Your ECR image URI
- Port mappings: 8001, 8002, 8003
- Environment variables: Your secrets

### Step 4: Create Services
1. Create 3 ECS services (one per microservice)
2. Configure Application Load Balancer
3. Set up path-based routing

---

## Option 3: Docker Compose on EC2 (Simplest)

If you just want to run the existing docker-compose setup:

```bash
# Install Docker on EC2
sudo yum install -y docker  # Amazon Linux
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone project
git clone https://github.com/YOUR_USERNAME/microservices-backend.git
cd microservices-backend

# Update docker-compose.yml with production values
# Then run:
docker-compose up -d

# View logs
docker-compose logs -f
```

---

## Quick Cost Comparison (Monthly Estimate)

| Setup | Cost |
|-------|------|
| EC2 t2.micro (free tier) | $0 (first year) |
| EC2 t3.small | ~$15/month |
| ECS Fargate (3 services) | ~$30-50/month |
| MongoDB Atlas (M0 free) | $0 |
| CloudAMQP (free tier) | $0 |

---

## Recommended Path for Beginners

1. **Start with EC2 + PM2** (Option 1) - Cheapest, good learning
2. **Add Nginx** for reverse proxy
3. **Get a domain** from Route 53 or any registrar
4. **Add SSL** with Let's Encrypt (free)
5. **Scale to ECS** when you need auto-scaling

---

## SSL/HTTPS with Let's Encrypt (Free)

```bash
# Install Certbot
sudo yum install -y certbot python3-certbot-nginx  # Amazon Linux
sudo apt install -y certbot python3-certbot-nginx  # Ubuntu

# Get certificate (replace with your domain)
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo certbot renew --dry-run
```

---

## Useful AWS Services to Consider

| Service | Purpose |
|---------|---------|
| **Route 53** | Domain & DNS management |
| **CloudWatch** | Logs & monitoring |
| **Secrets Manager** | Store credentials securely |
| **RDS** | Managed MongoDB alternative |
| **ElastiCache** | Redis caching |
| **S3** | File storage |
