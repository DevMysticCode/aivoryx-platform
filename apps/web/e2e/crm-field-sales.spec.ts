import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM ↔ Field ↔ Commercial workflow (Phase 18): lead → schedule a visit from the
 * lead → the field agent works it and records an outcome → CRM sees the outcome and
 * the follow-up it created → quotation prepared from the visit → navigate the related
 * records — plus module-combination and responsive checks.
 *
 * Opt-in; needs a running web app + API + database with the demo seeds loaded
 * (`seed:field-demo`, `seed:commercial-demo`, `seed:platform-demo`, `seed:crm-field-demo`):
 *
 *   RUN_CRM_FIELD_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 E2E_API_BASE_URL=http://localhost:4000 \
 *   pnpm --filter @aivoryx/web test:e2e crm-field-sales.spec.ts
 */
const ENABLED = process.env.RUN_CRM_FIELD_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL ?? 'agent@clans-demo.test';
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-Passw0rd!';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';
const SOUTHBRIDGE_EMAIL = process.env.E2E_TENANT_B_ADMIN_EMAIL ?? 'admin@southbridge-demo.test';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const raw = res.headers()['set-cookie'] ?? '';
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]!;
  const membershipId = (await res.json()).memberships?.[0]?.id as string;
  await request.post(`${API_BASE}/api/v1/auth/switch-tenant`, {
    headers: { cookie },
    data: { membershipId },
  });
  return { cookie, membershipId };
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test.describe('CRM ↔ Field ↔ Commercial (Phase 18)', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_CRM_FIELD_E2E=1 + E2E_ADMIN_*');

  // the journey builds on shared state (lead → visit → quotation), so it runs in order
  test.describe.configure({ mode: 'serial' });

  const stamp = Date.now().toString(36);
  const leadName = `Sales Journey ${stamp}`;
  let leadId = '';
  let visitId = '';

  test('1–3. qualify a lead and schedule a Field visit FROM the lead, assigned to an agent', async ({
    page,
    request,
  }) => {
    const admin = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await request.post(`${API_BASE}/api/v1/crm/leads`, {
      headers: { cookie: admin.cookie },
      data: {
        name: leadName,
        phone: `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10),
        addressLine: '7 Solar Street',
        city: 'Pune',
      },
    });
    expect(created.ok()).toBeTruthy();
    leadId = (await created.json()).id;
    const q = await request.post(`${API_BASE}/api/v1/crm/leads/${leadId}/qualify`, {
      headers: { cookie: admin.cookie },
      data: { outcome: 'QUALIFIED', note: 'Ready for a site assessment' },
    });
    expect(q.ok()).toBeTruthy();

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`/crm/leads/${leadId}`);
    await page.getByRole('tab', { name: 'Related' }).click();
    await expect(page.getByRole('heading', { name: /site visits/i })).toBeVisible();

    await page.getByRole('button', { name: 'Schedule visit' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Schedule a site visit' });
    await expect(dialog).toBeVisible();
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    await dialog.getByLabel('Date and time').fill(when);
    const agentSelect = dialog.getByLabel('Field agent (optional)');
    const agentValue = await agentSelect.evaluate((el) => {
      const opt = [...(el as HTMLSelectElement).options].find((o) => /agent/i.test(o.text));
      return opt?.value ?? '';
    });
    expect(agentValue, 'a designated field agent exists').not.toBe('');
    await agentSelect.selectOption(agentValue);
    await dialog.getByLabel(/instructions for the agent/i).fill('Ring the bell twice.');
    await dialog.getByRole('button', { name: 'Schedule visit' }).click();
    await expect(dialog).toBeHidden();

    // the visit is now listed on the lead, as a real link to the visit
    const visitLink = page.locator('a[href*="/crm/visits/"]').first();
    await expect(visitLink).toBeVisible();
    const href = await visitLink.getAttribute('href');
    expect(href).toMatch(/\/crm\/visits\/[0-9a-f-]+$/);
    visitId = href!.split('/').pop()!;
  });

  test('4–6. the field agent works the visit and records an outcome; CRM sees it and the follow-up', async ({
    page,
    request,
  }) => {
    test.skip(!visitId, 'needs the visit from the previous step');
    const agent = await apiLogin(request, AGENT_EMAIL, DEMO_PASSWORD);
    // GPS steps go through the API (a browser can't grant real geolocation here)
    for (const step of ['check-in', 'check-out']) {
      const res = await request.post(`${API_BASE}/api/v1/visits/${visitId}/${step}`, {
        headers: { cookie: agent.cookie },
        data: { lat: 18.52, lng: 73.85, accuracyM: 6 },
      });
      expect(res.ok(), step).toBeTruthy();
    }

    // the site survey (required questions are tenant-configured) — also via the API
    const defs = (await (
      await request.get(`${API_BASE}/api/v1/visits/${visitId}/survey`, {
        headers: { cookie: agent.cookie },
      })
    ).json()) as { key: string; dataType: string; isRequired: boolean; options: string[] | null }[];
    const values: Record<string, unknown> = {};
    for (const d of defs) {
      if (!d.isRequired) continue;
      values[d.key] =
        d.dataType === 'number'
          ? 1
          : d.dataType === 'boolean'
            ? true
            : d.dataType === 'date'
              ? '2030-01-01'
              : d.dataType === 'select'
                ? d.options?.[0]
                : 'ok';
    }
    const survey = await request.post(`${API_BASE}/api/v1/visits/${visitId}/survey`, {
      headers: { cookie: agent.cookie },
      data: { values },
    });
    expect(survey.ok(), 'survey').toBeTruthy();

    await signIn(page, AGENT_EMAIL, DEMO_PASSWORD);
    await page.goto(`/field/visits/${visitId}`);
    // lead context only — a field agent has no CRM link
    await expect(page.getByRole('heading', { name: leadName })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /lead/i }).filter({ hasText: leadName }),
    ).toHaveCount(0);
    await expect(page.locator('a[href^="/crm/"]')).toHaveCount(0);

    await page.getByRole('radio', { name: /follow-up required/i }).check();
    await page.getByLabel('Outcome note').fill('Owner wants to confirm the roof lease');
    await page.getByRole('button', { name: 'Mark visit complete' }).click();
    // the server really completed it, with the outcome
    await expect
      .poll(async () => {
        const r = await request.get(`${API_BASE}/api/v1/visits/${visitId}`, {
          headers: { cookie: agent.cookie },
        });
        const v = (await r.json()) as { status: string; outcome: string | null };
        return `${v.status}/${v.outcome}`;
      })
      .toBe('COMPLETED/FOLLOW_UP_REQUIRED');
    // …and the page swaps the form for the recorded outcome
    await expect(
      page.getByRole('button', { name: /mark visit complete|completing/i }),
    ).toBeHidden();

    // CRM: the lead's timeline and follow-ups carry it
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`/crm/leads/${leadId}`);
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText(/follow-up required/i).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Follow-ups' }).click();
    await expect(page.getByText(/Follow-up after site visit/i).first()).toBeVisible();
  });

  test('7–10. prepare a quotation from the visit and navigate the related records', async ({
    page,
  }) => {
    test.skip(!visitId, 'needs the visit from the previous steps');
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`/crm/leads/${leadId}`);
    await page.getByRole('tab', { name: 'Related' }).click();

    // the completed visit is offered as the quotation's source
    const source = page.getByLabel('Prepared from visit');
    await expect(source).toBeVisible();
    await page.getByRole('button', { name: /^new/i }).click();
    await page.waitForURL('**/quotations/**');

    // quotation → its related records: lead + the visit it was prepared from
    const related = page.getByRole('navigation', { name: /related records/i });
    await expect(related.getByRole('link', { name: new RegExp(leadName) })).toBeVisible();
    await related.getByRole('link', { name: /visit/i }).click();
    await page.waitForURL(`**/crm/visits/${visitId}`);

    // visit → back to the lead, with the recorded outcome
    await expect(page.getByText('Follow-up required').first()).toBeVisible();
    await page
      .getByRole('link', { name: new RegExp(leadName) })
      .first()
      .click();
    await page.waitForURL(`**/crm/leads/${leadId}`);
  });

  test('CRM + Supply workspace (no Field, no Commercial): lead detail works, no integration UI, no Field requests', async ({
    page,
    request,
  }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(new URL(r.url()).pathname));
    const sb = await apiLogin(request, SOUTHBRIDGE_EMAIL, DEMO_PASSWORD);
    const made = await request.post(`${API_BASE}/api/v1/crm/leads`, {
      headers: { cookie: sb.cookie },
      data: {
        name: `CRM Only ${stamp}`,
        phone: `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10),
      },
    });
    expect(made.ok()).toBeTruthy();
    await signIn(page, SOUTHBRIDGE_EMAIL, DEMO_PASSWORD);
    await page.goto(`/crm/leads/${(await made.json()).id}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Related' }).click();
    await expect(page.getByRole('button', { name: 'Schedule visit' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /site visits/i })).toHaveCount(0);
    expect(
      requested.filter((p) => p.startsWith('/api/v1/visits') || p.includes('/quotations')),
    ).toEqual([]);
  });

  for (const width of [390, 768, 1024, 1440]) {
    test(`responsive: cross-module screens have no horizontal overflow at ${width}px`, async ({
      page,
    }) => {
      test.skip(!leadId, 'needs the lead from the first step');
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      for (const path of [
        `/crm/leads/${leadId}`,
        `/crm/visits/${visitId}`,
        '/crm/visits',
        '/crm',
      ]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        expect(await noHorizontalScroll(page), `${path} @ ${width}px`).toBe(true);
      }
      await page.goto(`/crm/leads/${leadId}`);
      await page.getByRole('tab', { name: 'Related' }).click();
      expect(await noHorizontalScroll(page), `related @ ${width}px`).toBe(true);
      await page.getByRole('button', { name: 'Schedule visit' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Schedule a site visit' })).toBeVisible();
      expect(await noHorizontalScroll(page), `dialog @ ${width}px`).toBe(true);
    });
  }
});
