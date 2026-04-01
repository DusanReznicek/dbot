export interface PromptTemplateContext {
  agents?: Array<{ id: string; name: string; description: string; capabilities: string[] }>;
  date?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Resolve {{variable}} placeholders in a template string.
 * Unknown variables are left as-is.
 */
export function resolveTemplate(template: string, context: PromptTemplateContext): string {
  if (!template) return '';

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    switch (key) {
      case 'date':
        return context.date ?? new Date().toISOString().split('T')[0];

      case 'agents':
        return context.agents ? JSON.stringify(context.agents, null, 2) : '[]';

      case 'agentNames':
        return context.agents ? context.agents.map((a) => a.name).join(', ') : '';

      case 'capabilities':
        return context.agents
          ? context.agents.flatMap((a) => a.capabilities).join(', ')
          : '';

      case 'message':
        return context.message ?? '';

      default:
        if (key in context && typeof context[key] === 'string') {
          return context[key] as string;
        }
        return `{{${key}}}`;
    }
  });
}
