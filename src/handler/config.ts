/**
 * Configuration for the Webhook Handler service
 * Environment variables will be moved to .env later
 */

// Environment Variables (to be moved to .env)
// DISCOURSE_WEBHOOK_SECRET=your_high_entropy_secret_here
// RABBITMQ_URL=amqp://localhost:5672
// QUEUE_NAME=discourse-events
// HANDLER_PORT=3000
// LOG_LEVEL=info

export interface HandlerConfig {
  discourseWebhookSecret: string
  rabbitmqUrl: string
  queueName: string
  port: number
  logLevel: string
}

export function getHandlerConfig(): HandlerConfig {
  const config: HandlerConfig = {
    discourseWebhookSecret:
      process.env.DISCOURSE_WEBHOOK_SECRET || "change_me_in_production",
    rabbitmqUrl: process.env.RABBITMQ_URL || "amqp://localhost:5672",
    queueName: process.env.QUEUE_NAME || "discourse-events",
    port: parseInt(process.env.HANDLER_PORT || "3000", 10),
    logLevel: process.env.LOG_LEVEL || "info",
  }

  // Validation
  if (config.discourseWebhookSecret === "change_me_in_production") {
    console.warn(
      "WARNING: Using default webhook secret. Set DISCOURSE_WEBHOOK_SECRET in production!"
    )
  }

  return config
}
