import amqp from "amqplib"
import logger from "./logger"
import { QueueMessage } from "./types"

/**
 * Message Queue abstraction using RabbitMQ
 * Implements the Message Bus component from the architecture
 */

export class MessageQueue {
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null
  private channel: Awaited<
    ReturnType<Awaited<ReturnType<typeof amqp.connect>>["createChannel"]>
  > | null = null
  private readonly queueName: string
  private readonly rabbitmqUrl: string

  constructor(queueName: string, rabbitmqUrl: string) {
    this.queueName = queueName
    this.rabbitmqUrl = rabbitmqUrl
  }

  /**
   * Establishes connection to RabbitMQ and creates channel
   */
  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.rabbitmqUrl)
      this.channel = await this.connection.createChannel()

      // Declare durable queue (survives broker restart)
      await this.channel.assertQueue(this.queueName, {
        durable: true,
        arguments: {
          "x-message-ttl": 86400000, // 24 hours TTL
          "x-max-length": 100000, // Max 100k messages
        },
      })

      logger.info({ queueName: this.queueName }, "Connected to RabbitMQ")

      // Handle connection events
      this.connection.on("error", (err: Error) => {
        logger.error({ err }, "RabbitMQ connection error")
      })

      this.connection.on("close", () => {
        logger.warn("RabbitMQ connection closed")
      })
    } catch (error) {
      logger.error({ error }, "Failed to connect to RabbitMQ")
      throw error
    }
  }

  /**
   * Publishes a message to the queue
   * @param message - Message to publish
   */
  async publish(message: QueueMessage): Promise<boolean> {
    if (!this.channel) {
      throw new Error("Channel not initialized. Call connect() first")
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message))

      const success = this.channel.sendToQueue(this.queueName, messageBuffer, {
        persistent: true, // Survive broker restart
        contentType: "application/json",
        timestamp: Date.now(),
      })

      if (success) {
        logger.debug({ messageId: message.id }, "Message published to queue")
      } else {
        logger.warn(
          { messageId: message.id },
          "Queue buffer full, message not sent"
        )
      }

      return success
    } catch (error) {
      logger.error(
        { error, messageId: message.id },
        "Failed to publish message"
      )
      throw error
    }
  }

  /**
   * Consumes messages from the queue
   * @param handler - Callback function to process each message
   */
  async consume(
    handler: (message: QueueMessage) => Promise<void>
  ): Promise<void> {
    if (!this.channel) {
      throw new Error("Channel not initialized. Call connect() first")
    }

    // Set prefetch to 1 for fair dispatch
    await this.channel.prefetch(1)

    logger.info({ queueName: this.queueName }, "Starting message consumption")

    await this.channel.consume(
      this.queueName,
      async (msg: amqp.ConsumeMessage | null) => {
        if (!msg) {
          return
        }

        try {
          const message: QueueMessage = JSON.parse(msg.content.toString())
          logger.debug({ messageId: message.id }, "Processing message")

          await handler(message)

          // Acknowledge message after successful processing
          this.channel?.ack(msg)
          logger.debug({ messageId: message.id }, "Message acknowledged")
        } catch (error) {
          logger.error({ error }, "Error processing message")

          // Reject and requeue the message (with limit)
          const retryCount =
            (msg.properties.headers?.["x-retry-count"] as number) || 0

          if (retryCount < 3) {
            logger.warn({ retryCount }, "Requeuing message for retry")
            this.channel?.reject(msg, true) // Requeue
          } else {
            logger.error("Max retries reached, moving to DLQ")
            this.channel?.reject(msg, false) // Don't requeue (send to DLQ if configured)
          }
        }
      },
      {
        noAck: false, // Manual acknowledgment
      }
    )
  }

  /**
   * Closes the connection
   */
  async close(): Promise<void> {
    try {
      await this.channel?.close()
      await this.connection?.close()
      logger.info("RabbitMQ connection closed")
    } catch (error) {
      logger.error({ error }, "Error closing RabbitMQ connection")
    }
  }

  /**
   * Health check
   */
  isConnected(): boolean {
    return this.connection !== null && this.channel !== null
  }
}
