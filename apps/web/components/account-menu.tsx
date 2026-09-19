'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { cn } from '@aivoryx/ui';
import * as api from '@/lib/api/admin';
import { useMe, adminKeys } from '@/lib/admin/use-admin';
import { Menu, MenuItem } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useAppearance } from '@/components/theme-provider';
import { APPEARANCE_OPTIONS, BRAND_CACHE_STORAGE_KEY } from '@/lib/theme/appearance';

/**
 * The account menu (§18) + company switcher (§19). Logout is a first-class,
 * always-visible action. Switching workspace uses the secure `switch-tenant`
 * API and then clears the entire query cache so no tenant-scoped data leaks
 * across the boundary.
 */
export function AccountMenu() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const appearance = useAppearance();

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      try {
        localStorage.removeItem(BRAND_CACHE_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.replace('/login');
    },
  });

  const doSwitch = async (membershipId: string) => {
    if (membershipId === me.data?.active?.membership.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await api.switchTenant(membershipId);
      qc.clear();
      await qc.invalidateQueries({ queryKey: adminKeys.me });
      toast.success('Workspace switched');
      setOpen(false);
      router.push('/');
    } catch {
      toast.error('Could not switch workspace');
    } finally {
      setSwitching(false);
    }
  };

  const user = me.data?.user;
  const active = me.data?.active;
  const memberships = me.data?.memberships ?? [];
  const label =
    active?.membership.tenantName ??
    (me.data?.isPlatformAdmin ? 'Aivoryx Platform' : 'No workspace');
  const initial = (user?.email ?? '?').charAt(0).toUpperCase();

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Account menu — ${label}`}
          className="flex h-9 items-center gap-2 rounded-md border border-transparent px-1.5 text-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span
            className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
            aria-hidden
          >
            {initial}
          </span>
          <span className="hidden max-w-[10rem] truncate sm:block">{label}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      )}
    >
      <div className="border-b px-2.5 py-2">
        <p className="truncate text-sm font-medium">{user?.email ?? '—'}</p>
        <p className="truncate text-xs text-muted-foreground">
          {me.data?.isPlatformAdmin ? 'Platform administrator' : label}
        </p>
      </div>

      <div className="border-b px-2.5 py-2">
        <p className="pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Appearance
        </p>
        <div
          role="radiogroup"
          aria-label="Appearance"
          className="grid grid-cols-3 gap-0.5 rounded-md bg-background-muted p-0.5"
        >
          {APPEARANCE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={appearance.preference === o.value}
              onClick={() => appearance.setPreference(o.value)}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                appearance.preference === o.value
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {memberships.length > 1 ? (
        <div className="border-b py-1">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Switch company
          </p>
          {memberships.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              disabled={switching || m.status !== 'active'}
              onClick={() => doSwitch(m.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent disabled:opacity-50',
              )}
            >
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate">{m.tenantName}</span>
              {m.id === active?.membership.id ? (
                <Check className="size-4 text-primary" aria-hidden />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="py-1">
        {active?.entitledModules.includes('HR') ? (
          <MenuItem href="/hr/me" icon={<UserRound className="size-4 text-muted-foreground" />}>
            My HR profile
          </MenuItem>
        ) : null}
        <MenuItem
          href="/settings/notifications"
          icon={<Bell className="size-4 text-muted-foreground" />}
        >
          Notification settings
        </MenuItem>
        {me.data?.isPlatformAdmin ? (
          <MenuItem
            href="/platform"
            icon={<ShieldCheck className="size-4 text-muted-foreground" />}
          >
            Platform administration
          </MenuItem>
        ) : null}
        <MenuItem danger icon={<LogOut className="size-4" />} onSelect={() => logout.mutate()}>
          {logout.isPending ? 'Signing out…' : 'Log out'}
        </MenuItem>
      </div>
    </Menu>
  );
}
