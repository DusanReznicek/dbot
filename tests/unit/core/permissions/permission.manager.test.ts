import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionManager } from '../../../../src/core/permissions/permission.manager.js';
import { PermissionError } from '../../../../src/core/utils/errors.js';

describe('PermissionManager', () => {
  let manager: PermissionManager;

  beforeEach(() => {
    manager = new PermissionManager();
  });

  describe('default state', () => {
    it('is disabled by default', () => {
      expect(manager.isEnabled()).toBe(false);
    });

    it('has no rules by default', () => {
      expect(manager.getRules()).toEqual([]);
    });

    it('blocks all communication when disabled', () => {
      const result = manager.check('agent-a', 'agent-b', 'some.action');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('globally disabled');
    });
  });

  describe('enable/disable', () => {
    it('can be enabled', () => {
      manager.setEnabled(true);
      expect(manager.isEnabled()).toBe(true);
    });

    it('blocks when enabled but no matching rule', () => {
      manager.setEnabled(true);
      const result = manager.check('agent-a', 'agent-b', 'some.action');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No permission rule');
    });
  });

  describe('addRule / removeRule', () => {
    it('adds a rule and returns it with an id', () => {
      const rule = manager.addRule({
        source: 'obsidian-agent',
        target: 'calendar-agent',
        actions: ['calendar.check'],
        requireConfirmation: false,
      });
      expect(rule.id).toBeDefined();
      expect(rule.source).toBe('obsidian-agent');
      expect(manager.getRules()).toHaveLength(1);
    });

    it('removes a rule by id', () => {
      const rule = manager.addRule({
        source: 'a',
        target: 'b',
        actions: [],
        requireConfirmation: false,
      });
      expect(manager.removeRule(rule.id)).toBe(true);
      expect(manager.getRules()).toHaveLength(0);
    });

    it('returns false when removing non-existent rule', () => {
      expect(manager.removeRule('non-existent')).toBe(false);
    });
  });

  describe('check', () => {
    beforeEach(() => {
      manager.setEnabled(true);
    });

    it('allows communication with matching rule', () => {
      manager.addRule({
        source: 'agent-a',
        target: 'agent-b',
        actions: ['action.one'],
        requireConfirmation: false,
      });

      const result = manager.check('agent-a', 'agent-b', 'action.one');
      expect(result.allowed).toBe(true);
      expect(result.requireConfirmation).toBe(false);
      expect(result.rule).toBeDefined();
    });

    it('denies communication for non-matching action', () => {
      manager.addRule({
        source: 'agent-a',
        target: 'agent-b',
        actions: ['action.one'],
        requireConfirmation: false,
      });

      const result = manager.check('agent-a', 'agent-b', 'action.two');
      expect(result.allowed).toBe(false);
    });

    it('allows any action when actions list is empty', () => {
      manager.addRule({
        source: 'agent-a',
        target: 'agent-b',
        actions: [],
        requireConfirmation: false,
      });

      const result = manager.check('agent-a', 'agent-b', 'anything');
      expect(result.allowed).toBe(true);
    });

    it('returns requireConfirmation when rule requires it', () => {
      manager.addRule({
        source: 'agent-a',
        target: 'agent-b',
        actions: [],
        requireConfirmation: true,
      });

      const result = manager.check('agent-a', 'agent-b', 'some.action');
      expect(result.allowed).toBe(true);
      expect(result.requireConfirmation).toBe(true);
    });

    it('denies communication in wrong direction', () => {
      manager.addRule({
        source: 'agent-a',
        target: 'agent-b',
        actions: [],
        requireConfirmation: false,
      });

      // Reversed direction
      const result = manager.check('agent-b', 'agent-a', 'some.action');
      expect(result.allowed).toBe(false);
    });
  });

  describe('enforce', () => {
    it('throws PermissionError when denied', () => {
      manager.setEnabled(true);
      expect(() => {
        manager.enforce('agent-a', 'agent-b', 'some.action');
      }).toThrow(PermissionError);
    });

    it('returns result when allowed', () => {
      manager.setEnabled(true);
      manager.addRule({
        source: 'agent-a',
        target: 'agent-b',
        actions: [],
        requireConfirmation: false,
      });

      const result = manager.enforce('agent-a', 'agent-b', 'some.action');
      expect(result.allowed).toBe(true);
    });
  });

  describe('loadFromFile', () => {
    it('handles non-existent file gracefully', () => {
      // Should not throw
      manager.loadFromFile('/nonexistent/path.yaml');
      expect(manager.isEnabled()).toBe(false);
      expect(manager.getRules()).toEqual([]);
    });
  });

  describe('getRules returns copies', () => {
    it('returned array is a copy', () => {
      manager.addRule({
        source: 'a',
        target: 'b',
        actions: [],
        requireConfirmation: false,
      });
      const rules = manager.getRules();
      rules.pop();
      expect(manager.getRules()).toHaveLength(1);
    });
  });
});
