import * as crypto from 'crypto';

/**
 * Security utilities for webhook signature validation
 * Based on GET_STARTED.md Section 2: Segurança e Verificação
 */

export interface SignatureValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates the Discourse webhook signature using HMAC-SHA256
 * 
 * CRITICAL: Must use raw bytes of the request body, NOT parsed JSON
 * The signature is compared using constant-time comparison to prevent timing attacks
 * 
 * @param rawBody - Raw request body as Buffer (NOT parsed JSON)
 * @param signature - Value from X-Discourse-Event-Signature header (format: "sha256=<hex_hash>")
 * @param secret - Shared secret configured in Discourse webhook settings
 * @returns Validation result with success status
 */
export function validateWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): SignatureValidationResult {
  try {
    // Extract hash from "sha256=<hash>" format
    if (!signature || !signature.startsWith('sha256=')) {
      return {
        valid: false,
        error: 'Invalid signature format. Expected "sha256=<hash>"'
      };
    }

    const receivedHash = signature.substring(7); // Remove "sha256=" prefix

    // Calculate expected HMAC-SHA256 hash
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(receivedHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );

    if (!isValid) {
      return {
        valid: false,
        error: 'Signature mismatch. Request may be tampered or secret is incorrect'
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Signature validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Generates a secure random secret for webhook configuration
 * @returns High-entropy secret string (UUID format)
 */
export function generateWebhookSecret(): string {
  return crypto.randomUUID();
}

