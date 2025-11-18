# Discourse Webhook Integration: Webhook-to-Message-Bus Architecture

A robust, event-driven architecture for real-time integration of Discourse notifications with external systems using TypeScript.

## 📋 Overview

This project implements the **Webhook-to-Message-Bus** pattern for processing Discourse events in real-time. It solves the ambiguity between:

1. **Administrative Monitoring** (e.g., new users, user approvals)
2. **User Notification Aggregation** (e.g., mentions, replies, private messages)

Based on the architectural recommendations in [GET_STARTED.md](./GET_STARTED.md), this solution provides a scalable, decoupled approach superior to API polling or direct MessageBus subscriptions.

## 🏗️ Architecture

The system consists of four decoupled components:

```
Discourse (Webhook) → Handler (Validation + Publish) → Message Queue → Workers (Processing)
```

### Components

1. **Event Source (Discourse)**: Configured to send HTTP POST webhooks for specific events
2. **Ingestion Handler** (`src/handler/`): Lightweight, stateless service that validates HMAC-SHA256 signatures and publishes to queue
3. **Message Bus** (RabbitMQ): Durable broker that queues events for asynchronous processing
4. **Workers** (`src/worker/`): Independent services that consume messages and execute business logic

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.x
- RabbitMQ (or compatible message broker)
- Discourse instance with admin access

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### Running Services

```bash
# Development mode (with hot reload)
npm run dev:handler   # Start webhook handler on port 3000
npm run dev:worker    # Start message consumer

# Production mode
npm run build         # Compile TypeScript
npm run start:handler # Start handler
npm run start:worker  # Start worker
```

## ⚙️ Configuration

### 1. RabbitMQ Setup

```bash
# Using Docker
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3-management

# Access management UI: http://localhost:15672
# Default credentials: guest/guest
```

### 2. Discourse Webhook Configuration

Navigate to your Discourse admin panel: `/admin/api/web_hooks`

**Required Settings:**
- **Payload URL**: `https://your-domain.com/webhook`
- **Content Type**: `application/json`
- **Secret**: Generate with `node -e "console.log(require('crypto').randomUUID())"` and add to `.env`
- **Event Triggers**:
  - ✅ **User Event** (user_created, user_approved, user_updated)
  - ✅ **Notification Event** (@mentions, replies, badges, private messages)
  - ❌ Avoid "Send me everything" in production

### 3. Environment Variables

See [.env.example](./.env.example) for all configuration options.

**Critical Settings:**
```bash
DISCOURSE_WEBHOOK_SECRET=your_uuid_here  # MUST match Discourse config
RABBITMQ_URL=amqp://localhost:5672
HANDLER_PORT=3000
```

## 🔒 Security

### Webhook Signature Validation

The handler **MUST** validate every request using HMAC-SHA256:

1. Discourse sends `X-Discourse-Event-Signature: sha256=<hex_hash>`
2. Handler calculates HMAC-SHA256 of raw request body
3. Comparison uses constant-time algorithm to prevent timing attacks

**Implementation:** See `src/shared/security.ts`

### Best Practices

- ✅ Always use HTTPS in production
- ✅ Keep webhook secret in environment variables (never commit)
- ✅ Validate signature before processing
- ✅ Use constant-time comparison (`crypto.timingSafeEqual`)
- ✅ Set appropriate rate limits

## 📦 Project Structure

```
discourse-webhook/
├── src/
│   ├── handler/              # Webhook ingestion service
│   │   ├── index.ts         # Fastify server + webhook endpoint
│   │   └── config.ts        # Handler configuration
│   │
│   ├── worker/              # Message consumer service
│   │   ├── index.ts         # Consumer main loop
│   │   ├── config.ts        # Worker configuration
│   │   └── processors.ts    # Event processing logic
│   │
│   └── shared/              # Shared utilities
│       ├── types.ts         # TypeScript interfaces
│       ├── security.ts      # Signature validation
│       ├── logger.ts        # Pino logger
│       └── queue.ts         # RabbitMQ abstraction
│
├── .env.example             # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Development

### Adding New Event Processors

Edit `src/worker/processors.ts` to add custom business logic:

```typescript
// Example: Process user creation
export async function processUserEvent(event: DiscourseWebhookEvent) {
  const { user } = event.payload as DiscourseUserPayload;
  
  // Your custom logic
  await database.users.create({
    discourse_id: user.id,
    username: user.username,
    email: user.email
  });
  
  await slack.notify(`New user: @${user.username}`);
}
```

### Event Types

**User Events (Goal 1):**
- `user_created`: New user registered
- `user_approved`: User approved by moderator
- `user_updated`: Profile updated (⚠️ unreliable for post_count)

**Notification Events (Goal 2):**
- `notification`: User received interaction
  - Type 1: Mentioned (@username)
  - Type 2: Replied to post
  - Type 6: Private message
  - Type 12: Badge granted
  - [See all types in src/shared/types.ts]

## 🧪 Testing

```bash
# Run tests
npm test

# Lint code
npm run lint

# Test webhook locally
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Discourse-Event: user_created" \
  -H "X-Discourse-Event-Signature: sha256=<calculated_hash>" \
  -d '{"user": {"id": 1, "username": "test"}}'
```

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "discourse-webhook-handler",
  "queue_connected": true,
  "timestamp": "2025-11-18T10:00:00.000Z"
}
```

### Logs

The system uses structured logging (Pino):

```bash
# Development: Pretty-printed
npm run dev:handler

# Production: JSON format for log aggregation
NODE_ENV=production npm run start:handler
```

## ⚠️ Anti-Patterns (Avoided)

This implementation explicitly avoids:

### ❌ API Polling
**Problem**: Would require N+1 queries (1 per user) causing rate limiting
**Solution**: Event-driven webhooks

### ❌ Direct MessageBus Subscription
**Problem**: Internal tool, not public API, blocked by CORS, session-coupled
**Solution**: Webhook-to-Message-Bus pattern

See [GET_STARTED.md](./GET_STARTED.md) for detailed analysis.

## 🐳 Docker Deployment (Optional)

```dockerfile
# Example Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
CMD ["node", "dist/handler/index.js"]
```

## 📚 References

- [GET_STARTED.md](./GET_STARTED.md) - Detailed architectural documentation
- [Discourse Webhook API](https://meta.discourse.org/t/setting-up-webhooks/49045)
- [RabbitMQ Documentation](https://www.rabbitmq.com/documentation.html)

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please follow the existing code style and add tests for new features.

---

**Need Help?** See [GET_STARTED.md](./GET_STARTED.md) for comprehensive implementation details.

