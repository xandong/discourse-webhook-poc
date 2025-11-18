# Architecture Documentation

## System Overview

This document provides a detailed technical overview of the Discourse Webhook Integration architecture.

## High-Level Architecture

```
┌─────────────────┐
│    Discourse    │
│   (Event Source)│
└────────┬────────┘
         │ HTTP POST Webhook
         │ X-Discourse-Event-Signature: sha256=...
         │ X-Discourse-Event: user_created
         ▼
┌─────────────────────────────────────┐
│    Handler Service (Ingestion)      │
│  ┌──────────────────────────────┐  │
│  │ 1. Receive POST              │  │
│  │ 2. Validate HMAC-SHA256      │  │
│  │ 3. Publish to Queue          │  │
│  │ 4. Return 200 OK             │  │
│  └──────────────────────────────┘  │
│    Fastify + TypeScript             │
│    Port 3000                        │
└────────┬────────────────────────────┘
         │
         │ Publish Message
         ▼
┌─────────────────────────────────────┐
│    Message Queue (Broker)           │
│  ┌──────────────────────────────┐  │
│  │ Queue: discourse-events      │  │
│  │ Durable: Yes                 │  │
│  │ TTL: 24 hours               │  │
│  │ Max Length: 100k messages    │  │
│  └──────────────────────────────┘  │
│    RabbitMQ 3.x                     │
└────────┬────────────────────────────┘
         │
         │ Consume Messages
         ▼
┌─────────────────────────────────────┐
│    Worker Service (Consumer)        │
│  ┌──────────────────────────────┐  │
│  │ 1. Consume from Queue        │  │
│  │ 2. Route by Event Type       │  │
│  │ 3. Process Business Logic    │  │
│  │ 4. ACK/NACK Message          │  │
│  └──────────────────────────────┘  │
│    TypeScript Worker                │
│    Prefetch: 1                      │
└─────────────────────────────────────┘
```

## Component Details

### 1. Handler Service (Ingestion Endpoint)

**Technology**: Fastify (Node.js)  
**Location**: `src/handler/`  
**Port**: 3000 (configurable)

#### Responsibilities
1. Receive HTTP POST webhooks from Discourse
2. Extract and validate signature header
3. Validate HMAC-SHA256 signature using constant-time comparison
4. Parse JSON payload
5. Publish message to RabbitMQ queue
6. Return fast response (< 100ms target)

#### Key Features
- **Stateless**: No local storage, scales horizontally
- **Security First**: All requests validated before processing
- **Fast Response**: Immediate 200 OK to Discourse after queuing
- **Raw Body Handling**: Critical for signature validation

#### Endpoints

##### POST /webhook
Receives Discourse webhook events.

**Request Headers:**
```
X-Discourse-Event: user_created
X-Discourse-Event-Signature: sha256=abc123...
X-Discourse-Event-Id: uuid
X-Discourse-Instance: https://discourse.example.com
Content-Type: application/json
```

**Response:**
```json
{
  "status": "queued",
  "message_id": "uuid"
}
```

##### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "discourse-webhook-handler",
  "queue_connected": true,
  "timestamp": "2025-11-18T10:00:00.000Z"
}
```

### 2. Message Queue (RabbitMQ)

**Technology**: RabbitMQ 3.x  
**Ports**: 5672 (AMQP), 15672 (Management UI)

#### Queue Configuration
```javascript
{
  queueName: "discourse-events",
  durable: true,              // Survive broker restart
  messageTtl: 86400000,       // 24 hours
  maxLength: 100000,          // 100k messages max
  prefetch: 1                 // Fair dispatch to workers
}
```

#### Message Format
```typescript
{
  id: "uuid",                 // Message identifier
  event: {
    event_type: "user_created",
    payload: { /* Discourse payload */ },
    headers: { /* Webhook headers */ },
    received_at: "ISO-8601"
  },
  timestamp: "ISO-8601",
  retry_count: 0
}
```

#### Retry Strategy
- **Max Retries**: 3
- **Strategy**: Exponential backoff
- **Failed Messages**: Move to Dead Letter Queue (DLQ)

### 3. Worker Service (Consumer)

**Technology**: Node.js + TypeScript  
**Location**: `src/worker/`

#### Responsibilities
1. Establish persistent connection to RabbitMQ
2. Consume messages from queue (prefetch = 1)
3. Route messages to appropriate processor
4. Execute business logic
5. Acknowledge successful processing
6. Reject and requeue failed messages (with retry limit)

#### Event Routing

```typescript
if (event_type.startsWith('user_')) {
  // Goal 1: Administrative Monitoring
  processUserEvent()
} else if (event_type === 'notification') {
  // Goal 2: User Notification Aggregation
  processNotificationEvent()
} else {
  // Fallback
  processGenericEvent()
}
```

#### Processors

##### User Event Processor
Handles: `user_created`, `user_approved`, `user_updated`

**Business Logic Examples:**
- Store user in database
- Send admin notification (Slack, email)
- Trigger welcome workflow
- Update analytics dashboard

##### Notification Event Processor
Handles: `notification` events

**Business Logic by Type:**
- **Mentioned (1)**: Send push notification, aggregate in notification center
- **Replied (2)**: Update conversation thread, send email
- **Private Message (6)**: High-priority notification
- **Badge Granted (12)**: Celebrate achievement, update profile

##### Generic Event Processor
Handles all other event types.

**Business Logic:**
- Log for analytics
- Store in data warehouse
- Forward to other systems

## Data Flow

### Successful Flow
```
1. Discourse → Handler: POST /webhook
2. Handler: Validate signature ✓
3. Handler → Queue: Publish message
4. Handler → Discourse: 200 OK (queued)
5. Queue → Worker: Deliver message
6. Worker: Process business logic ✓
7. Worker → Queue: ACK message
8. Message deleted from queue
```

### Error Flow (Invalid Signature)
```
1. Discourse → Handler: POST /webhook
2. Handler: Validate signature ✗
3. Handler → Discourse: 403 Forbidden
4. Handler: Log security incident
```

### Error Flow (Processing Failure)
```
1. Queue → Worker: Deliver message
2. Worker: Process business logic ✗
3. Worker → Queue: NACK message (retry_count < 3)
4. Queue: Requeue message (with incremented retry_count)
5. Repeat until retry_count = 3
6. Worker → Queue: NACK (no requeue)
7. Message moved to DLQ
```

## Security Architecture

### Signature Validation (HMAC-SHA256)

```typescript
// 1. Extract signature from header
const signature = "sha256=abc123..."

// 2. Calculate expected hash from raw body
const expected = hmac_sha256(rawBody, SECRET)

// 3. Constant-time comparison (prevents timing attacks)
const valid = crypto.timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expected)
)
```

**Critical Security Rules:**
1. ✅ MUST use raw request body (not parsed JSON)
2. ✅ MUST use constant-time comparison
3. ✅ MUST reject invalid signatures (403)
4. ✅ MUST store secret in environment variables
5. ✅ MUST use HTTPS in production

### Network Security

**Production Recommendations:**
- Use VPC/private networking for queue
- Whitelist Discourse IP addresses
- Enable TLS for all connections
- Use API Gateway/Load Balancer with WAF
- Implement rate limiting

## Scalability

### Handler Scaling
- **Stateless Design**: No shared state between instances
- **Horizontal Scaling**: Add more handler instances behind load balancer
- **Auto-Scaling**: Scale based on HTTP request rate
- **Target**: < 100ms response time

### Worker Scaling
- **Queue Depth**: Monitor `messages_ready` metric
- **Message Age**: Alert if messages age > 5 minutes
- **Scaling Strategy**: Add workers when queue depth > 100
- **Concurrency**: Set `WORKER_CONCURRENCY` based on workload

### Queue Scaling
- **Message Throughput**: RabbitMQ handles ~50k msg/sec
- **Clustering**: Use RabbitMQ cluster for HA
- **Sharding**: Multiple queues if needed (by event type)

## Monitoring & Observability

### Key Metrics

#### Handler Metrics
- `webhooks_received_total` (counter)
- `webhooks_invalid_signature_total` (counter)
- `webhook_processing_duration_seconds` (histogram)
- `queue_publish_failures_total` (counter)

#### Worker Metrics
- `events_processed_total` (counter by event_type)
- `event_processing_duration_seconds` (histogram)
- `processing_errors_total` (counter)

#### Queue Metrics
- `queue_messages_ready` (gauge)
- `queue_messages_unacknowledged` (gauge)
- `queue_message_age_seconds` (histogram)

### Logging

**Structured JSON Logging (Pino):**
```json
{
  "level": "info",
  "time": 1700308800000,
  "messageId": "uuid",
  "eventType": "user_created",
  "duration": 45,
  "msg": "Webhook processed successfully"
}
```

### Alerting Rules

1. **Critical**: Handler service down
2. **Critical**: Worker service down
3. **Critical**: Queue connection lost
4. **Warning**: Queue depth > 1000
5. **Warning**: Invalid signatures > 10/min
6. **Warning**: Processing errors > 5% rate

## Technology Stack

### Core
- **Language**: TypeScript 5.3+
- **Runtime**: Node.js 18+
- **HTTP Framework**: Fastify 4.x
- **Message Broker**: RabbitMQ 3.x

### Libraries
- **amqplib**: RabbitMQ client
- **pino**: Structured logging
- **crypto**: Built-in (signature validation)

### Infrastructure
- **Container Runtime**: Docker
- **Orchestration**: Kubernetes / ECS / Cloud Run
- **Load Balancer**: ALB / Cloud Load Balancer
- **Monitoring**: CloudWatch / Prometheus / Datadog

## Performance Targets

### Handler
- **Response Time**: p95 < 100ms
- **Throughput**: 1000 req/sec per instance
- **Availability**: 99.9%

### Worker
- **Processing Time**: p95 < 500ms per event
- **Throughput**: 50 events/sec per worker
- **Error Rate**: < 1%

### Queue
- **Message Latency**: p95 < 1 second
- **Message Loss**: 0% (durable queue)
- **Availability**: 99.95%

## Disaster Recovery

### Backup Strategy
- **Queue**: Durable messages (survive broker restart)
- **Dead Letter Queue**: Manual review and reprocess
- **Logs**: 30-day retention in log aggregation service

### Recovery Procedures
1. **Handler Down**: Auto-restart, load balancer redirects traffic
2. **Worker Down**: Messages remain in queue, auto-restart worker
3. **Queue Down**: Handler returns 503, Discourse retries webhook
4. **Data Corruption**: Replay from DLQ or Discourse webhook logs

## Future Enhancements

### Planned
- [ ] GraphQL API for webhook management
- [ ] Real-time dashboard (WebSocket)
- [ ] Event replay capability
- [ ] Multi-tenant support
- [ ] Enhanced observability (OpenTelemetry)

### Considered
- [ ] Replace RabbitMQ with AWS SQS/SNS
- [ ] Add event filtering/routing rules
- [ ] Webhook transformation pipeline
- [ ] Event schema validation (JSON Schema)

---

For implementation details, see [README.md](./README.md).  
For deployment guides, see [DEPLOYMENT.md](./DEPLOYMENT.md).

