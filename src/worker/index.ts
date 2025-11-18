/**
 * Worker Consumer Service
 *
 * Architecture Component: Consumidores (Workers)
 * Responsibilities:
 * 1. Consume messages from the message queue
 * 2. Execute business logic based on event type
 * 3. Handle errors and retries
 * 4. Acknowledge processed messages
 *
 * Based on GET_STARTED.md implementation guide
 */

import { getWorkerConfig } from "./config"
import { MessageQueue } from "../shared/queue"
import { QueueMessage, DiscourseWebhookEvent } from "../shared/types"
import {
  // processUserEvent,
  processNotificationEvent,
  // processGenericEvent,
} from "./processors"
import logger from "../shared/logger"

// Initialize configuration
const config = getWorkerConfig()

// Initialize Message Queue
const messageQueue = new MessageQueue(config.queueName, config.rabbitmqUrl)

/**
 * Route message to appropriate processor based on event type
 */
async function routeMessage(message: QueueMessage): Promise<void> {
  const event: DiscourseWebhookEvent = message.event
  const eventType = event.event_type

  logger.info(
    {
      messageId: message.id,
      eventType,
      timestamp: message.timestamp,
    },
    "Routing message to processor"
  )

  try {
    let result

    // Route based on event type
    if (eventType === "notification" || eventType === "notification_created") {
      // Goal 2: User Notification Aggregation
      result = await processNotificationEvent(event)
    } else {
      // Ignorando outros eventos para focar nos logs de notificação
      logger.debug({ eventType }, "Ignoring event type")
      return // Sai da função para eventos não relacionados a notificação
    }

    result
    // logger.info(
    //   {
    //     messageId: message.id,
    //     eventType,
    //     success: result.success,
    //     message,
    //   },
    //   "Message processed successfully"
    // )
  } catch (error) {
    logger.error(
      {
        messageId: message.id,
        eventType,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Error processing message"
    )
    throw error // Re-throw to trigger retry mechanism
  }
}

/**
 * Start the worker
 */
async function start(): Promise<void> {
  try {
    logger.info("Starting worker consumer service...")

    // Connect to message queue
    logger.info("Connecting to RabbitMQ...")
    await messageQueue.connect()

    // Start consuming messages
    logger.info(
      {
        queueName: config.queueName,
        concurrency: config.concurrency,
      },
      "Starting message consumption"
    )

    await messageQueue.consume(routeMessage)

    logger.info("Worker consumer service started successfully")
  } catch (error) {
    logger.error({ error }, "Failed to start worker consumer service")
    process.exit(1)
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  logger.info("Shutting down worker consumer service...")

  try {
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

// Unhandled errors
process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled Rejection")
})

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught Exception")
  process.exit(1)
})

// Start the worker
start()
