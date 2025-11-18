/**
 * Configuration for the Worker Consumer service
 * Environment variables will be moved to .env later
 */

// Environment Variables (to be moved to .env)
// RABBITMQ_URL=amqp://localhost:5672
// QUEUE_NAME=discourse-events
// LOG_LEVEL=info
// WORKER_CONCURRENCY=1

export interface WorkerConfig {
  rabbitmqUrl: string;
  queueName: string;
  logLevel: string;
  concurrency: number;
}

export function getWorkerConfig(): WorkerConfig {
  return {
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
    queueName: process.env.QUEUE_NAME || 'discourse-events',
    logLevel: process.env.LOG_LEVEL || 'info',
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1', 10)
  };
}

