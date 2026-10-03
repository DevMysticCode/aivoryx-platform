import type { Snippet } from '@/components/admin/code-snippet';
import { webhookUrlFor } from './integration-urls';

/**
 * Generates developer code samples (UC-4) from the connection's real webhook URL and auth
 * method — never a hand-invented request field. Secrets are ALWAYS a placeholder; this must
 * never receive a real credential value as input.
 */
export function buildSnippets(source: {
  connectorType: string;
  key: string;
  publicLookupKey: string | null;
  authMethod: 'bearer_secret' | 'signature';
}): Snippet[] {
  const url = webhookUrlFor(source);
  const sample = { name: 'Jane Doe', phone: '9999999999', email: 'jane@example.com' };
  const body = JSON.stringify(sample, null, 2);
  const note =
    source.authMethod === 'bearer_secret'
      ? '# Use this secret server-side. Never expose it in browser/client-side code.\n'
      : '# This connection is signature-verified by the provider — no bearer secret is sent.\n';

  const curl = `${note}curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n${
    source.authMethod === 'bearer_secret' ? `  -H 'Authorization: Bearer <YOUR_SECRET>' \\\n` : ''
  }  -d '${JSON.stringify(sample)}'`;

  const js = `// ${note.trim()}
await fetch('${url}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
${source.authMethod === 'bearer_secret' ? "    Authorization: 'Bearer <YOUR_SECRET>',\n" : ''}  },
  body: JSON.stringify(${body}),
});`;

  const python = `import requests

# ${note.trim()}
response = requests.post(
    "${url}",
    headers={
        "Content-Type": "application/json",
${source.authMethod === 'bearer_secret' ? '        "Authorization": "Bearer <YOUR_SECRET>",\n' : ''}    },
    json=${sampleAsPythonDict(sample)},
)`;

  return [
    { label: 'cURL', code: curl },
    { label: 'JavaScript', code: js },
    { label: 'Python', code: python },
  ];
}

function sampleAsPythonDict(sample: Record<string, string>): string {
  const entries = Object.entries(sample)
    .map(([k, v]) => `"${k}": "${v}"`)
    .join(', ');
  return `{${entries}}`;
}
