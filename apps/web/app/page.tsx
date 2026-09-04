import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function OverviewPage() {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Platform foundation</h1>
        <p className="text-sm text-muted-foreground">
          Phase 1 is the reusable technical foundation only — no business modules yet. The API,
          database, Redis/queue, logging, error handling and CI are wired and verifiable.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {[
          ['Next.js + PWA shell', 'apps/web'],
          ['NestJS REST API · /api/v1', 'apps/api'],
          ['PostgreSQL + Drizzle (UUIDv7)', 'packages/db'],
          ['Redis + BullMQ infrastructure', 'apps/api/src/queue'],
          ['Pino logs + correlation IDs', 'apps/api/src/observability'],
          ['Zod-validated config', 'packages/config'],
        ].map(([title, path]) => (
          <li key={path} className="rounded-lg border p-4">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{path}</p>
          </li>
        ))}
      </ul>

      <Link
        href="/health"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        Check system health
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
