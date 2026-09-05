import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 2 — Tenant Administration & User Lifecycle (ADR 0030).
 *
 * Categories: TENANT, MEMBERS, ROLES, INVITATIONS, SECURITY. The direct
 * PostgreSQL RLS proof lives in `rls.int.spec.ts`; this file drives the HTTP
 * surface and the invitation lifecycle end to end.
 */
describe.skipIf(!INTEGRATION_ENABLED)('tenant administration & user lifecycle', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });

  /** Cookie for `fx.admin` with tenant A active. */
  const adminCookie = async (): Promise<string> => {
    const res = await login(fx.admin.email, fx.admin.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };

  /** Cookie for `fx.adminB` — single membership, auto-selected into tenant B. */
  const adminBCookie = async (): Promise<string> =>
    sessionCookie(await login(fx.adminB.email, fx.adminB.password));

  const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@invitee.test`;

  // ---- TENANT -------------------------------------------------------------

  describe('TENANT', () => {
    it('GET /admin/tenant returns the active workspace with member counts', async () => {
      const cookie = await adminCookie();
      const res = await http.get('/api/v1/admin/tenant').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fx.tenantA);
      expect(res.body.slug).toMatch(/^a-/);
      expect(res.body.memberCounts.total).toBeGreaterThanOrEqual(5);
      expect(res.body.memberCounts.active).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /admin/tenant updates the name; GET reflects it', async () => {
      const cookie = await adminCookie();
      const patch = await http
        .patch('/api/v1/admin/tenant')
        .set('Cookie', cookie)
        .send({ name: 'Renamed Workspace A' });
      expect(patch.status).toBe(200);
      expect(patch.body.name).toBe('Renamed Workspace A');

      const get = await http.get('/api/v1/admin/tenant').set('Cookie', cookie);
      expect(get.body.name).toBe('Renamed Workspace A');
    });

    it('PATCH /admin/tenant rejects an empty name with 400', async () => {
      const cookie = await adminCookie();
      const res = await http.patch('/api/v1/admin/tenant').set('Cookie', cookie).send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('unauthenticated → 401, authenticated-but-unauthorized → 403', async () => {
      const anon = await http.get('/api/v1/admin/tenant');
      expect(anon.status).toBe(401);
      expect(anon.body.error.code).toBe('AUTH_UNAUTHENTICATED');

      const limited = sessionCookie(await login(fx.limited.email, fx.limited.password));
      const forbidden = await http.get('/api/v1/admin/tenant').set('Cookie', limited);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('tenant A cannot modify tenant B (RLS scopes the write to the active tenant)', async () => {
      const cookie = await adminCookie(); // tenant A active
      await http.patch('/api/v1/admin/tenant').set('Cookie', cookie).send({ name: 'Hijacked B' });

      const pool = await rawPool();
      try {
        const { rows } = await pool.query<{ name: string }>(
          'select name from tenants where id = $1',
          [fx.tenantB],
        );
        expect(rows[0]?.name).not.toBe('Hijacked B');
      } finally {
        await pool.end();
      }
    });
  });

  // ---- MEMBERS ----------------------------------------------------------

  describe('MEMBERS', () => {
    it('GET /admin/members lists the workspace members', async () => {
      const cookie = await adminCookie();
      const res = await http.get('/api/v1/admin/members').set('Cookie', cookie);
      expect(res.status).toBe(200);
      const ids = res.body.map((m: { membershipId: string }) => m.membershipId);
      expect(ids).toContain(fx.admin.membershipId);
      expect(ids).toContain(fx.plainMember.membershipId);
      expect(ids).not.toContain(fx.adminB.membershipId); // tenant B is invisible
    });

    it('GET /admin/members/:id returns one member; unknown id → 404', async () => {
      const cookie = await adminCookie();
      const ok = await http
        .get(`/api/v1/admin/members/${fx.plainMember.membershipId}`)
        .set('Cookie', cookie);
      expect(ok.status).toBe(200);
      expect(ok.body.email).toBe(fx.plainMember.email);

      const missing = await http.get(`/api/v1/admin/members/${randomUUID()}`).set('Cookie', cookie);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('MEMBER_NOT_FOUND');
    });

    it('suspend then reactivate a membership', async () => {
      const cookie = await adminCookie();
      const suspended = await http
        .patch(`/api/v1/admin/members/${fx.plainMember.membershipId}`)
        .set('Cookie', cookie)
        .send({ status: 'suspended' });
      expect(suspended.status).toBe(200);
      expect(suspended.body.status).toBe('suspended');

      const reactivated = await http
        .patch(`/api/v1/admin/members/${fx.plainMember.membershipId}`)
        .set('Cookie', cookie)
        .send({ status: 'active' });
      expect(reactivated.status).toBe(200);
      expect(reactivated.body.status).toBe('active');
    });

    it('DELETE /admin/members/:id removes a membership (204)', async () => {
      const cookie = await adminCookie();
      const invite = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookie)
        .send({ email: uniqueEmail('to-delete'), name: 'Temp' });
      const membershipId = invite.body.member.membershipId;

      const del = await http.delete(`/api/v1/admin/members/${membershipId}`).set('Cookie', cookie);
      expect(del.status).toBe(204);

      const after = await http.get(`/api/v1/admin/members/${membershipId}`).set('Cookie', cookie);
      expect(after.status).toBe(404);
    });

    it('tenant A cannot read or modify a tenant B membership', async () => {
      const cookie = await adminCookie();
      const read = await http
        .get(`/api/v1/admin/members/${fx.adminB.membershipId}`)
        .set('Cookie', cookie);
      expect(read.status).toBe(404);

      const patch = await http
        .patch(`/api/v1/admin/members/${fx.adminB.membershipId}`)
        .set('Cookie', cookie)
        .send({ status: 'suspended' });
      expect(patch.status).toBe(404);

      const del = await http
        .delete(`/api/v1/admin/members/${fx.adminB.membershipId}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(404);
    });

    it('a non-admin cannot invite or mutate members (403)', async () => {
      const cookie = sessionCookie(await login(fx.limited.email, fx.limited.password));
      const invite = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookie)
        .send({ email: uniqueEmail('nope') });
      expect(invite.status).toBe(403);

      const patch = await http
        .patch(`/api/v1/admin/members/${fx.plainMember.membershipId}`)
        .set('Cookie', cookie)
        .send({ status: 'suspended' });
      expect(patch.status).toBe(403);
    });
  });

  // ---- ROLES ----------------------------------------------------------

  describe('ROLES', () => {
    it('GET /admin/roles and /admin/permissions', async () => {
      const cookie = await adminCookie();
      const roles = await http.get('/api/v1/admin/roles').set('Cookie', cookie);
      expect(roles.status).toBe(200);
      const keys = roles.body.map((r: { key: string }) => r.key);
      expect(keys).toContain('TENANT_ADMIN');
      expect(keys).toContain('MEMBERS_ONLY');

      const perms = await http.get('/api/v1/admin/permissions').set('Cookie', cookie);
      expect(perms.status).toBe(200);
      const { PERMISSION_KEYS } = await import('@aivoryx/shared');
      expect(perms.body.map((p: { key: string }) => p.key).sort()).toEqual(
        [...PERMISSION_KEYS].sort(),
      );
    });

    it('assign then remove a generic role (idempotent assign)', async () => {
      const cookie = await adminCookie();
      const first = await http
        .post(`/api/v1/admin/members/${fx.plainMember.membershipId}/roles`)
        .set('Cookie', cookie)
        .send({ roleKey: 'MEMBERS_ONLY' });
      expect(first.status).toBe(200);
      expect(first.body.roles.map((r: { key: string }) => r.key)).toContain('MEMBERS_ONLY');

      const again = await http
        .post(`/api/v1/admin/members/${fx.plainMember.membershipId}/roles`)
        .set('Cookie', cookie)
        .send({ roleKey: 'MEMBERS_ONLY' });
      expect(again.status).toBe(200);
      expect(
        again.body.roles.filter((r: { key: string }) => r.key === 'MEMBERS_ONLY'),
      ).toHaveLength(1);

      const removed = await http
        .delete(`/api/v1/admin/members/${fx.plainMember.membershipId}/roles/MEMBERS_ONLY`)
        .set('Cookie', cookie);
      expect(removed.status).toBe(200);
      expect(removed.body.roles.map((r: { key: string }) => r.key)).not.toContain('MEMBERS_ONLY');
    });

    it('assigning an unknown role → 404 ROLE_NOT_FOUND', async () => {
      const cookie = await adminCookie();
      const res = await http
        .post(`/api/v1/admin/members/${fx.plainMember.membershipId}/roles`)
        .set('Cookie', cookie)
        .send({ roleKey: 'NO_SUCH_ROLE' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROLE_NOT_FOUND');
    });

    it('tenant A cannot assign a role to a tenant B membership (404)', async () => {
      const cookie = await adminCookie();
      const res = await http
        .post(`/api/v1/admin/members/${fx.adminB.membershipId}/roles`)
        .set('Cookie', cookie)
        .send({ roleKey: 'MEMBERS_ONLY' });
      expect(res.status).toBe(404);
    });
  });

  // ---- INVITATIONS --------------------------------------------------

  describe('INVITATIONS', () => {
    it('creating an invitation returns a one-time token and an invited member', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('valid');
      const res = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookie)
        .send({ email, name: 'Valid Invitee', roleKeys: ['MEMBERS_ONLY'] });
      expect(res.status).toBe(200);
      expect(res.body.member.status).toBe('invited');
      expect(res.body.member.invitationPending).toBe(true);
      expect(res.body.member.roles.map((r: { key: string }) => r.key)).toContain('MEMBERS_ONLY');
      expect(typeof res.body.invitation.token).toBe('string');
      expect(res.body.invitation.token.length).toBeGreaterThan(20);
      expect(new Date(res.body.invitation.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('stores only a SHA-256 hash of the token; the plaintext is never persisted', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('hash');
      const res = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const token: string = res.body.invitation.token;
      const invitationId: string = res.body.invitation.id;

      const pool = await rawPool();
      try {
        const byHash = await pool.query('select token_hash from tenant_invitations where id = $1', [
          invitationId,
        ]);
        const expected = createHash('sha256').update(token, 'utf8').digest('hex');
        expect(byHash.rows[0].token_hash).toBe(expected);

        const byRaw = await pool.query('select 1 from tenant_invitations where token_hash = $1', [
          token,
        ]);
        expect(byRaw.rowCount).toBe(0);
      } finally {
        await pool.end();
      }
    });

    it('the token is never echoed by the authenticated member APIs', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('secret');
      const invite = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const token: string = invite.body.invitation.token;
      const membershipId: string = invite.body.member.membershipId;

      const list = await http.get('/api/v1/admin/members').set('Cookie', cookie);
      expect(JSON.stringify(list.body)).not.toContain(token);

      const one = await http.get(`/api/v1/admin/members/${membershipId}`).set('Cookie', cookie);
      expect(JSON.stringify(one.body)).not.toContain(token);
      expect(one.body.invitation).toBeUndefined();
    });

    it('a valid token is accepted once: sets the first password and activates the membership', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('accept');
      const invite = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookie)
        .send({ email, name: 'Accept Me' });
      const token: string = invite.body.invitation.token;
      const membershipId: string = invite.body.member.membershipId;

      const accept = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token, password: 'brand-new-passphrase' });
      expect(accept.status).toBe(200);
      expect(accept.body).toMatchObject({ ok: true, email });
      expect(accept.body.tenantSlug).toMatch(/^a-/);

      // membership is now active
      const member = await http.get(`/api/v1/admin/members/${membershipId}`).set('Cookie', cookie);
      expect(member.body.status).toBe('active');
      expect(member.body.invitationPending).toBe(false);

      // the invitee can now authenticate with the password they chose
      const signIn = await login(email, 'brand-new-passphrase');
      expect(signIn.status).toBe(201);
    });

    it('replaying an accepted token → 409 INVITATION_ALREADY_USED', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('replay');
      const invite = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const token: string = invite.body.invitation.token;

      const first = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token, password: 'first-time-passphrase' });
      expect(first.status).toBe(200);

      const second = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token, password: 'first-time-passphrase' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('INVITATION_ALREADY_USED');
    });

    it('an expired token → 410 INVITATION_EXPIRED', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('expired');
      const invite = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const token: string = invite.body.invitation.token;
      const invitationId: string = invite.body.invitation.id;

      const pool = await rawPool();
      try {
        await pool.query(
          "update tenant_invitations set expires_at = now() - interval '1 minute' where id = $1",
          [invitationId],
        );
      } finally {
        await pool.end();
      }

      const accept = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token, password: 'does-not-matter-here' });
      expect(accept.status).toBe(410);
      expect(accept.body.error.code).toBe('INVITATION_EXPIRED');
    });

    it('a superseded (revoked) token → 410 INVITATION_REVOKED', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('revoked');
      const first = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const staleToken: string = first.body.invitation.token;

      // re-inviting the same address supersedes the pending invitation
      const second = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      expect(second.status).toBe(200);
      expect(second.body.invitation.token).not.toBe(staleToken);

      const accept = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token: staleToken, password: 'whatever-passphrase' });
      expect(accept.status).toBe(410);
      expect(accept.body.error.code).toBe('INVITATION_REVOKED');
    });

    it('an unknown token → 400 INVITATION_INVALID', async () => {
      const accept = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token: 'x'.repeat(43), password: 'whatever-passphrase' });
      expect(accept.status).toBe(400);
      expect(accept.body.error.code).toBe('INVITATION_INVALID');
    });

    it('a first-time account must choose a password → 400 INVITATION_PASSWORD_REQUIRED', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('needs-pw');
      const invite = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const token: string = invite.body.invitation.token;

      const accept = await http.post('/api/v1/auth/accept-invitation').send({ token });
      expect(accept.status).toBe(400);
      expect(accept.body.error.code).toBe('INVITATION_PASSWORD_REQUIRED');
    });

    it('an existing account (already has a password) accepts without providing one', async () => {
      const cookie = await adminCookie();
      // fx.suspended already has a password and a (suspended) membership in tenant A
      const invite = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookie)
        .send({ email: fx.suspended.email });
      expect(invite.status).toBe(200);
      const token: string = invite.body.invitation.token;

      const accept = await http.post('/api/v1/auth/accept-invitation').send({ token });
      expect(accept.status).toBe(200);
      expect(accept.body.email).toBe(fx.suspended.email);

      // original credentials still work
      const signIn = await login(fx.suspended.email, fx.suspended.password);
      expect(signIn.status).toBe(201);
    });

    it('an invitation is tenant-bound: a tenant B token lands the invitee in tenant B', async () => {
      const cookieB = await adminBCookie();
      const email = uniqueEmail('tenant-b');
      const invite = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookieB)
        .send({ email });
      const token: string = invite.body.invitation.token;
      const membershipId: string = invite.body.member.membershipId;

      // a tenant A admin cannot see that invited membership at all
      const cookieA = await adminCookie();
      const fromA = await http.get(`/api/v1/admin/members/${membershipId}`).set('Cookie', cookieA);
      expect(fromA.status).toBe(404);

      const accept = await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token, password: 'tenant-b-passphrase' });
      expect(accept.status).toBe(200);
      expect(accept.body.tenantSlug).toMatch(/^b-/);
    });

    it('the outbox records exactly one user.invitation.created event per invitation', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('outbox');
      const invite = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const invitationId: string = invite.body.invitation.id;

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          `select type, tenant_id, payload from outbox_events
           where type = 'user.invitation.created' and payload->>'invitationId' = $1`,
          [invitationId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].tenant_id).toBe(fx.tenantA);
        expect(rows[0].payload.email).toBe(email);
      } finally {
        await pool.end();
      }
    });
  });

  // ---- SECURITY ---------------------------------------------------

  describe('SECURITY', () => {
    it('inviting an already-active member → 409 MEMBER_ALREADY_EXISTS', async () => {
      const cookie = await adminCookie();
      const res = await http
        .post('/api/v1/admin/members')
        .set('Cookie', cookie)
        .send({ email: fx.plainMember.email });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MEMBER_ALREADY_EXISTS');
    });

    it('the last usable TENANT_ADMIN cannot be suspended, removed, or stripped of the role', async () => {
      const cookie = await adminBCookie(); // adminB is the ONLY admin of tenant B
      const self = fx.adminB.membershipId;

      const suspend = await http
        .patch(`/api/v1/admin/members/${self}`)
        .set('Cookie', cookie)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(409);
      expect(suspend.body.error.code).toBe('TENANT_LAST_ADMIN');

      const remove = await http.delete(`/api/v1/admin/members/${self}`).set('Cookie', cookie);
      expect(remove.status).toBe(409);
      expect(remove.body.error.code).toBe('TENANT_LAST_ADMIN');

      const strip = await http
        .delete(`/api/v1/admin/members/${self}/roles/TENANT_ADMIN`)
        .set('Cookie', cookie);
      expect(strip.status).toBe(409);
      expect(strip.body.error.code).toBe('TENANT_LAST_ADMIN');
    });

    it('a second admin CAN be suspended while another active admin remains', async () => {
      const cookie = await adminCookie(); // tenant A has admin + secondAdmin
      const suspend = await http
        .patch(`/api/v1/admin/members/${fx.secondAdmin.membershipId}`)
        .set('Cookie', cookie)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(200);
      expect(suspend.body.status).toBe('suspended');

      // a suspended admin can no longer act in that tenant
      const theirLogin = await login(fx.secondAdmin.email, fx.secondAdmin.password);
      const theirCookie = sessionCookie(theirLogin);
      const switchBack = await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', theirCookie)
        .send({ membershipId: fx.secondAdmin.membershipId });
      expect(switchBack.status).toBe(403);
      expect(switchBack.body.error.code).toBe('AUTH_MEMBERSHIP_SUSPENDED');

      // restore for any later assertions
      const reactivate = await http
        .patch(`/api/v1/admin/members/${fx.secondAdmin.membershipId}`)
        .set('Cookie', cookie)
        .send({ status: 'active' });
      expect(reactivate.status).toBe(200);
    });

    it('removing a membership cascades the sessions active in that tenant', async () => {
      const cookie = await adminCookie();
      const email = uniqueEmail('removed');
      const invite = await http.post('/api/v1/admin/members').set('Cookie', cookie).send({ email });
      const token: string = invite.body.invitation.token;
      const membershipId: string = invite.body.member.membershipId;

      await http
        .post('/api/v1/auth/accept-invitation')
        .send({ token, password: 'removed-user-passphrase' });
      const theirCookie = sessionCookie(await login(email, 'removed-user-passphrase'));
      expect((await http.get('/api/v1/auth/me').set('Cookie', theirCookie)).status).toBe(200);

      const del = await http.delete(`/api/v1/admin/members/${membershipId}`).set('Cookie', cookie);
      expect(del.status).toBe(204);

      const after = await http.get('/api/v1/auth/me').set('Cookie', theirCookie);
      expect(after.status).toBe(401);
    });

    it('unauthenticated writes are 401, not 403', async () => {
      expect(
        (await http.post('/api/v1/admin/members').send({ email: uniqueEmail('x') })).status,
      ).toBe(401);
      expect(
        (
          await http
            .patch(`/api/v1/admin/members/${fx.plainMember.membershipId}`)
            .send({ status: 'suspended' })
        ).status,
      ).toBe(401);
      expect((await http.patch('/api/v1/admin/tenant').send({ name: 'x' })).status).toBe(401);
    });
  });
});
