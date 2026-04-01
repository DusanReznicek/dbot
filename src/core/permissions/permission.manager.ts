import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'js-yaml';
import type { PermissionRule, PermissionCheckResult, PermissionConfig } from './permission.types.js';
import { PermissionError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PermissionManager');

export interface IPermissionManager {
  loadFromFile(filePath: string): void;
  check(source: string, target: string, action: string): PermissionCheckResult;
  addRule(rule: Omit<PermissionRule, 'id'>): PermissionRule;
  removeRule(ruleId: string): boolean;
  getRules(): PermissionRule[];
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export class PermissionManager implements IPermissionManager {
  private rules: PermissionRule[] = [];
  private enabled = false;

  /**
   * Load permission rules from a YAML config file.
   */
  loadFromFile(filePath: string): void {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) {
      logger.warn({ filePath: absPath }, 'Permissions config file not found, using defaults');
      return;
    }

    const raw = readFileSync(absPath, 'utf-8');
    const config = YAML.load(raw) as PermissionConfig;

    this.enabled = config.interAgentCommunication?.enabled ?? false;
    this.rules = [];

    for (const pair of config.interAgentCommunication?.allowedPairs ?? []) {
      this.rules.push({
        id: randomUUID(),
        source: pair.source,
        target: pair.target,
        actions: pair.actions ?? [],
        requireConfirmation: pair.requireConfirmation ?? false,
      });
    }

    logger.info(
      { enabled: this.enabled, ruleCount: this.rules.length },
      'Permission rules loaded',
    );
  }

  /**
   * Check whether a source agent can communicate with a target agent for a given action.
   */
  check(source: string, target: string, action: string): PermissionCheckResult {
    // If permissions are globally disabled, block all inter-agent communication
    if (!this.enabled) {
      return {
        allowed: false,
        requireConfirmation: false,
        reason: 'Inter-agent communication is globally disabled',
      };
    }

    // Find a matching rule
    const rule = this.rules.find((r) => {
      if (r.source !== source || r.target !== target) return false;
      // If actions list is empty, all actions are allowed
      if (r.actions.length === 0) return true;
      return r.actions.includes(action);
    });

    if (!rule) {
      return {
        allowed: false,
        requireConfirmation: false,
        reason: `No permission rule for ${source} → ${target} (action: ${action})`,
      };
    }

    return {
      allowed: true,
      requireConfirmation: rule.requireConfirmation,
      rule,
    };
  }

  /**
   * Enforce a permission check — throws PermissionError if denied.
   */
  enforce(source: string, target: string, action: string): PermissionCheckResult {
    const result = this.check(source, target, action);
    if (!result.allowed) {
      throw new PermissionError(
        result.reason || 'Permission denied',
        source,
        target,
        action,
      );
    }
    return result;
  }

  /**
   * Add a new runtime permission rule.
   */
  addRule(rule: Omit<PermissionRule, 'id'>): PermissionRule {
    const newRule: PermissionRule = { ...rule, id: randomUUID() };
    this.rules.push(newRule);
    logger.info({ ruleId: newRule.id, source: rule.source, target: rule.target }, 'Permission rule added');
    return newRule;
  }

  /**
   * Remove a permission rule by ID.
   */
  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    logger.info({ ruleId }, 'Permission rule removed');
    return true;
  }

  /**
   * Get all current permission rules.
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * Check if inter-agent communication is globally enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable inter-agent communication globally.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info({ enabled }, 'Inter-agent communication toggled');
  }
}
