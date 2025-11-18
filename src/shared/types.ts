/**
 * Shared type definitions for Discourse webhook events
 * Based on GET_STARTED.md documentation
 */

// Discourse Event Types
export enum DiscourseEventType {
  USER_CREATED = "user_created",
  USER_UPDATED = "user_updated",
  USER_APPROVED = "user_approved",
  NOTIFICATION = "notification",
  POST_CREATED = "post_created",
  TOPIC_CREATED = "topic_created",
}

// Notification Types (enum integers from Discourse)
export enum NotificationType {
  MENTIONED = 1,
  REPLIED = 2,
  QUOTED = 3,
  EDITED = 4,
  LIKED = 5,
  PRIVATE_MESSAGE = 6,
  INVITED_TO_PRIVATE_MESSAGE = 7,
  INVITEE_ACCEPTED = 8,
  POSTED = 9,
  MOVED_POST = 10,
  LINKED = 11,
  GRANTED_BADGE = 12,
  INVITED_TO_TOPIC = 13,
  CUSTOM = 14,
  GROUP_MENTIONED = 15,
  GROUP_MESSAGE_SUMMARY = 16,
  WATCHING_FIRST_POST = 17,
  TOPIC_REMINDER = 18,
  LIKED_CONSOLIDATED = 19,
  POST_APPROVED = 20,
  CODE_REVIEW_COMMIT_APPROVED = 21,
  MEMBERSHIP_REQUEST_ACCEPTED = 22,
  MEMBERSHIP_REQUEST_CONSOLIDATED = 23,
  BOOKMARK_REMINDER = 24,
  REACTION = 25,
  VOTES_RELEASED = 26,
  EVENT_REMINDER = 27,
  EVENT_INVITATION = 28,
  CHAT_MENTION = 29,
  CHAT_MESSAGE = 30,
  CHAT_INVITATION = 31,
  CHAT_GROUP_MENTION = 32,
  CHAT_QUOTED = 33,
}

// User Event Payload (Goal 1 - Administrative Monitoring)
export interface DiscourseUserPayload {
  user: {
    id: number
    username: string
    name?: string
    email?: string
    created_at: string
    trust_level: number
    admin?: boolean
    moderator?: boolean
    avatar_template?: string
    post_count?: number
    locale?: string
    active?: boolean
  }
}

// Notification Event Payload (Goal 2 - User Notification Aggregation)
export interface DiscourseNotificationPayload {
  notification: {
    id: number
    user_id: number // Critical for routing
    notification_type: NotificationType
    read: boolean
    created_at: string
    updated_at: string
    data: {
      original_username?: string
      original_post_id?: number
      topic_title?: string
      display_username?: string
      badge_id?: number
      badge_name?: string
      [key: string]: unknown
    }
    topic_id?: number
    post_number?: number
  }
}

// Generic Discourse Webhook Event
export interface DiscourseWebhookEvent {
  event_type: DiscourseEventType | string
  payload:
    | DiscourseUserPayload
    | DiscourseNotificationPayload
    | Record<string, unknown>
  headers: {
    "x-discourse-event": string
    "x-discourse-event-signature": string
    "x-discourse-event-id"?: string
    "x-discourse-instance"?: string
  }
  received_at: string
}

// Message Queue Message Structure
export interface QueueMessage {
  id: string
  event: DiscourseWebhookEvent
  timestamp: string
  retry_count?: number
}

// Worker Processing Result
export interface ProcessingResult {
  success: boolean
  message_id: string
  event_type: string
  error?: string
  processed_at: string
}
