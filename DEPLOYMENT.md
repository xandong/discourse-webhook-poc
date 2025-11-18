# Deployment Guide

This guide covers different deployment scenarios for the Discourse Webhook Integration.

## 📦 Local Development

### Prerequisites
- Node.js 18+
- RabbitMQ (or use Docker)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start RabbitMQ (using Docker)
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# 3. Configure environment
cp env.example .env
# Edit .env with your settings

# 4. Start services
npm run dev:handler  # Terminal 1
npm run dev:worker   # Terminal 2
```

## 🐳 Docker Compose (Recommended for Testing)

### Quick Start

```bash
# 1. Set environment variables
export DISCOURSE_WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomUUID())")

# 2. Start all services
docker-compose up -d

# 3. View logs
docker-compose logs -f handler
docker-compose logs -f worker

# 4. Access RabbitMQ Management UI
# http://localhost:15672 (guest/guest)

# 5. Stop services
docker-compose down
```

### Service URLs
- **Handler**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **RabbitMQ Management**: http://localhost:15672

## ☁️ Production Deployment

### Option 1: AWS (Recommended)

#### Architecture
```
Internet Gateway
    ↓
Application Load Balancer (HTTPS)
    ↓
Lambda (Handler) → SQS/RabbitMQ → ECS Fargate (Worker)
```

#### Handler on AWS Lambda

1. **Build for Lambda**:
```bash
npm run build
cd dist/handler
npm install --production
zip -r handler.zip .
```

2. **Create Lambda Function**:
```bash
aws lambda create-function \
  --function-name discourse-webhook-handler \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb://handler.zip \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-execution-role \
  --environment Variables="{
    DISCOURSE_WEBHOOK_SECRET=your_secret,
    RABBITMQ_URL=amqps://your-mq.amazonaws.com:5671,
    QUEUE_NAME=discourse-events
  }"
```

3. **Create API Gateway**:
```bash
# Create REST API
aws apigateway create-rest-api --name discourse-webhook-api

# Configure POST /webhook endpoint
# Integrate with Lambda function
# Deploy to stage
```

#### Worker on ECS Fargate

1. **Push Docker Image**:
```bash
docker build -f Dockerfile.worker -t discourse-worker .
docker tag discourse-worker:latest YOUR_ECR_REPO/discourse-worker:latest
docker push YOUR_ECR_REPO/discourse-worker:latest
```

2. **Create ECS Task Definition**:
```json
{
  "family": "discourse-worker",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [{
    "name": "worker",
    "image": "YOUR_ECR_REPO/discourse-worker:latest",
    "environment": [
      {"name": "RABBITMQ_URL", "value": "amqps://your-mq.amazonaws.com:5671"},
      {"name": "QUEUE_NAME", "value": "discourse-events"}
    ]
  }]
}
```

3. **Create ECS Service**:
```bash
aws ecs create-service \
  --cluster discourse-cluster \
  --service-name discourse-worker \
  --task-definition discourse-worker \
  --desired-count 2 \
  --launch-type FARGATE
```

#### Amazon MQ (RabbitMQ)

```bash
aws mq create-broker \
  --broker-name discourse-broker \
  --engine-type RABBITMQ \
  --engine-version 3.11 \
  --host-instance-type mq.t3.micro \
  --deployment-mode SINGLE_INSTANCE \
  --auto-minor-version-upgrade \
  --publicly-accessible false
```

### Option 2: Google Cloud Platform

#### Handler on Cloud Run

```bash
# Build and push
gcloud builds submit --tag gcr.io/PROJECT_ID/discourse-handler

# Deploy
gcloud run deploy discourse-handler \
  --image gcr.io/PROJECT_ID/discourse-handler \
  --platform managed \
  --region us-central1 \
  --set-env-vars DISCOURSE_WEBHOOK_SECRET=xxx,RABBITMQ_URL=xxx
```

#### Worker on Cloud Run (Background)

```bash
gcloud run deploy discourse-worker \
  --image gcr.io/PROJECT_ID/discourse-worker \
  --platform managed \
  --no-allow-unauthenticated
```

### Option 3: Azure

#### Handler on Azure Functions

```bash
# Create function app
az functionapp create \
  --resource-group discourse-rg \
  --consumption-plan-location westus \
  --runtime node \
  --functions-version 4 \
  --name discourse-handler

# Deploy
func azure functionapp publish discourse-handler
```

#### Worker on Azure Container Instances

```bash
az container create \
  --resource-group discourse-rg \
  --name discourse-worker \
  --image YOUR_ACR/discourse-worker:latest \
  --environment-variables RABBITMQ_URL=xxx QUEUE_NAME=xxx
```

### Option 4: Kubernetes (Advanced)

```yaml
# handler-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: discourse-handler
spec:
  replicas: 3
  selector:
    matchLabels:
      app: discourse-handler
  template:
    metadata:
      labels:
        app: discourse-handler
    spec:
      containers:
      - name: handler
        image: your-registry/discourse-handler:latest
        ports:
        - containerPort: 3000
        env:
        - name: DISCOURSE_WEBHOOK_SECRET
          valueFrom:
            secretKeyRef:
              name: discourse-secrets
              key: webhook-secret
        - name: RABBITMQ_URL
          value: "amqp://rabbitmq:5672"
---
apiVersion: v1
kind: Service
metadata:
  name: discourse-handler
spec:
  type: LoadBalancer
  ports:
  - port: 443
    targetPort: 3000
  selector:
    app: discourse-handler
```

```yaml
# worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: discourse-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: discourse-worker
  template:
    metadata:
      labels:
        app: discourse-worker
    spec:
      containers:
      - name: worker
        image: your-registry/discourse-worker:latest
        env:
        - name: RABBITMQ_URL
          value: "amqp://rabbitmq:5672"
```

## 🔒 Security Checklist

### Pre-Production
- [ ] Generate strong webhook secret (UUID)
- [ ] Store secrets in environment variables or secret manager
- [ ] Enable HTTPS/TLS for all endpoints
- [ ] Configure firewall rules (only allow Discourse IP)
- [ ] Set up monitoring and alerting
- [ ] Configure log aggregation
- [ ] Test signature validation
- [ ] Set up rate limiting

### Production
- [ ] Use managed message queue service
- [ ] Enable queue encryption at rest
- [ ] Use VPC/private networking
- [ ] Implement auto-scaling for workers
- [ ] Set up dead letter queue (DLQ)
- [ ] Configure backup and disaster recovery
- [ ] Document incident response procedures
- [ ] Set up performance monitoring

## 📊 Monitoring

### CloudWatch (AWS)

```javascript
// Add to handler
const cloudwatch = new AWS.CloudWatch();
cloudwatch.putMetricData({
  MetricData: [{
    MetricName: 'WebhooksReceived',
    Value: 1,
    Unit: 'Count'
  }]
});
```

### Prometheus Metrics

```javascript
// Add to worker
const promClient = require('prom-client');
const processedCounter = new promClient.Counter({
  name: 'events_processed_total',
  help: 'Total events processed'
});
```

## 🚨 Troubleshooting

### Handler Not Receiving Webhooks

1. Check Discourse webhook logs: `/admin/api/web_hooks/[ID]`
2. Verify firewall allows incoming traffic
3. Test health endpoint: `curl https://your-domain.com/health`
4. Check CloudWatch/application logs

### Worker Not Processing Messages

1. Verify RabbitMQ connection:
```bash
docker exec rabbitmq rabbitmqctl list_queues
```

2. Check message count:
```bash
curl -u guest:guest http://localhost:15672/api/queues/%2f/discourse-events
```

3. Restart worker service

### Signature Validation Failures

1. Verify secret matches between Discourse and handler
2. Check for trailing whitespace in secret
3. Ensure raw body is used (not parsed JSON)
4. Test with sample payload

## 📈 Scaling

### Handler Scaling
- **AWS Lambda**: Auto-scales to 1000 concurrent executions
- **Cloud Run**: Configure max instances
- **Kubernetes**: Use HPA (Horizontal Pod Autoscaler)

### Worker Scaling
- Monitor queue depth
- Scale workers based on message age
- Set worker concurrency appropriately

### Example HPA (Kubernetes)
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: discourse-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: discourse-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: External
    external:
      metric:
        name: rabbitmq_queue_messages_ready
      target:
        type: AverageValue
        averageValue: "30"
```

## 🔄 CI/CD

### GitHub Actions Example

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: 18
    - run: npm ci
    - run: npm test
    - run: npm run build
    - name: Deploy to AWS
      run: |
        # Deploy Lambda
        # Deploy ECS
```

---

**Need Help?** Check [README.md](./README.md) or open an issue.

