/**
 * Webhook Handler Service (Ingestion Endpoint)
 *
 * Architecture Component: Endpoint de Ingestão
 * Responsibilities:
 * 1. Receive HTTP POST webhooks from Discourse
 * 2. Validate HMAC-SHA256 signature
 * 3. Publish raw payload to message queue
 * 4. Return fast response to Discourse
 *
 * Based on GET_STARTED.md implementation guide
 */

import Fastify, { FastifyRequest, FastifyReply } from "fastify"
import { randomUUID } from "crypto"
import { getHandlerConfig } from "./config"
import { validateWebhookSignature } from "../shared/security"
import { MessageQueue } from "../shared/queue"
import { DiscourseWebhookEvent, QueueMessage } from "../shared/types"
import logger from "../shared/logger"

// Extend FastifyRequest to include rawBody
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

// Initialize configuration
const config = getHandlerConfig()

// Initialize Fastify
const app = Fastify({
  logger: false, // Use custom logger
  bodyLimit: 1048576, // 1MB limit
  disableRequestLogging: false,
})

// Initialize Message Queue
const messageQueue = new MessageQueue(config.queueName, config.rabbitmqUrl)

/**
 * Webhook endpoint
 * POST /webhook
 */
app.post("/webhook", async (request: FastifyRequest, reply: FastifyReply) => {
  const startTime = Date.now()

  try {
    // 1. Extract headers
    const signature = request.headers["x-discourse-event-signature"] as string
    const eventType = request.headers["x-discourse-event"] as string
    const eventId = request.headers["x-discourse-event-id"] as string
    const instance = request.headers["x-discourse-instance"] as string

    if (!signature) {
      logger.warn("Webhook received without signature header")
      return reply.code(400).send({
        error: "Bad Request",
        message: "Missing X-Discourse-Event-Signature header",
      })
    }

    if (!eventType) {
      logger.warn("Webhook received without event type header")
      return reply.code(400).send({
        error: "Bad Request",
        message: "Missing X-Discourse-Event header",
      })
    }

    // 2. Get raw body (CRITICAL: Must use raw bytes, not parsed JSON)
    const rawBody = request.rawBody as Buffer

    if (!rawBody) {
      logger.error("Raw body not available")
      return reply.code(500).send({
        error: "Internal Server Error",
        message: "Raw body not available",
      })
    }

    // 3. Validate signature
    const validationResult = validateWebhookSignature(
      rawBody,
      signature,
      config.discourseWebhookSecret
    )

    if (!validationResult.valid) {
      logger.warn(
        { error: validationResult.error, eventType },
        "Invalid webhook signature"
      )
      return reply.code(403).send({
        error: "Forbidden",
        message: "Invalid signature",
      })
    }

    // 4. Parse JSON payload
    const payload = JSON.parse(rawBody.toString("utf-8"))

    // 5. Create webhook event object
    const webhookEvent: DiscourseWebhookEvent = {
      event_type: eventType,
      payload,
      headers: {
        "x-discourse-event": eventType,
        "x-discourse-event-signature": signature,
        "x-discourse-event-id": eventId,
        "x-discourse-instance": instance,
      },
      received_at: new Date().toISOString(),
    }

    // 6. Create queue message
    const queueMessage: QueueMessage = {
      id: randomUUID(),
      event: webhookEvent,
      timestamp: new Date().toISOString(),
      retry_count: 0,
    }

    // 7. Publish to message queue
    const published = await messageQueue.publish(queueMessage)

    if (!published) {
      logger.error(
        { messageId: queueMessage.id },
        "Failed to publish message to queue"
      )
      return reply.code(503).send({
        error: "Service Unavailable",
        message: "Queue is full or unavailable",
      })
    }

    const duration = Date.now() - startTime

    logger.info(
      {
        messageId: queueMessage.id,
        eventType,
        eventId,
        duration,
      },
      "Webhook processed successfully"
    )

    // 8. Return fast response
    return reply.code(200).send({
      status: "queued",
      message_id: queueMessage.id,
    })
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        duration,
      },
      "Error processing webhook"
    )

    return reply.code(500).send({
      error: "Internal Server Error",
      message: "Failed to process webhook",
    })
  }
})

/**
 * Health check endpoint
 */
app.get("/health", async (_request: FastifyRequest, reply: FastifyReply) => {
  const isQueueConnected = messageQueue.isConnected()

  const status = isQueueConnected ? "healthy" : "degraded"
  const statusCode = isQueueConnected ? 200 : 503

  return reply.code(statusCode).send({
    status,
    service: "discourse-webhook-handler",
    queue_connected: isQueueConnected,
    timestamp: new Date().toISOString(),
  })
})

/**
 * Start the server
 */
async function start(): Promise<void> {
  try {
    // Connect to message queue
    logger.info("Connecting to RabbitMQ...")
    await messageQueue.connect()

    // Add raw body support
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (req, body: Buffer, done) => {
        req.rawBody = body
        done(null, body)
      }
    )

    // Start server
    await app.listen({ port: config.port, host: "0.0.0.0" })

    logger.info(
      {
        port: config.port,
        queueName: config.queueName,
      },
      "Webhook handler service started"
    )
  } catch (error) {
    logger.error({ error }, "Failed to start webhook handler service")
    process.exit(1)
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  logger.info("Shutting down webhook handler service...")

  try {
    await app.close()
    await messageQueue.close()
    logger.info("Shutdown complete")
    process.exit(0)
  } catch (error) {
    logger.error({ error }, "Error during shutdown")
    process.exit(1)
  }
}

// Handle shutdown signals
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// Start the service
start()
