import { getHealth } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'System health' };

export default async function HealthPage() {
  let report: Awaited<ReturnType<typeof getHealth>> | null = null;
  let error: string | null = null;

  try {
    report = await getHealth();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach the API';
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">System health</h1>
        <p className="text-sm text-muted-foreground">
          Live readiness of the API and its dependencies. This page always renders on the server
          with no caching.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">API unavailable</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <p className="mt-2 text-muted-foreground">
            Start the API with <code className="font-mono">pnpm --filter @aivoryx/api dev</code> and
            ensure <code className="font-mono">docker compose up -d</code> is running.
          </p>
        </div>
      ) : report ? (
        <div className="space-y-3">
          <StatusRow label="Overall" status={report.status} />
          <StatusRow
            label="Database"
            status={report.checks.database.status}
            detail={`${report.checks.database.latencyMs}ms · ${report.checks.database.detail ?? ''}`}
          />
          <StatusRow
            label="Redis"
            status={report.checks.redis.status}
            detail={`${report.checks.redis.latencyMs}ms · ${report.checks.redis.detail ?? ''}`}
          />
          <p className="pt-2 font-mono text-xs text-muted-foreground">
            correlation: {report.correlationId}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function StatusRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'ok' | 'error';
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <span
        className={
          status === 'ok'
            ? 'rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary'
            : 'rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive'
        }
      >
        {status === 'ok' ? 'Operational' : 'Degraded'}
      </span>
    </div>
  );
}
