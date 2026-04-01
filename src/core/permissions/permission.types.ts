/**
 * A single permission rule governing inter-agent communication.
 */
export interface PermissionRule {
  /** Unique identifier for this rule */
  id: string;
  /** Source agent ID (sender) */
  source: string;
  /** Target agent ID (receiver) */
  target: string;
  /** Allowed actions (empty = all actions allowed) */
  actions: string[];
  /** Whether user confirmation is required before delivery */
  requireConfirmation: boolean;
}

/**
 * Result of a permission check.
 */
export interface PermissionCheckResult {
  allowed: boolean;
  requireConfirmation: boolean;
  /** The matching rule, if any */
  rule?: PermissionRule;
  /** Reason for denial, if not allowed */
  reason?: string;
}

/**
 * Configuration loaded from permissions.yaml
 */
export interface PermissionConfig {
  interAgentCommunication: {
    enabled: boolean;
    allowedPairs: Array<{
      source: string;
      target: string;
      actions: string[];
      requireConfirmation: boolean;
    }>;
  };
}
