'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { createNote } from '@/lib/api/crm';
import { useCreateLead } from '@/lib/crm/use-crm';
import { Card, ErrorNote } from '@/components/admin/ui';

/**
 * Field-generated lead capture (Phase 4, ADR 0033). Submits through the
 * SAME `POST /crm/leads` endpoint the CRM uses, only setting
 * `origin: "field_agent"` — no separate field-lead API or model.
 */
export default function NewFieldLeadPage() {
  const router = useRouter();
  const createLead = useCreateLead();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">New lead</h1>
      <Card className="space-y-3">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() && !phone.trim()) return;
            const lead = await createLead.mutateAsync({
              name: name || undefined,
              phone: phone || undefined,
              addressLine: addressLine || undefined,
              city: city || undefined,
              origin: 'field_agent',
            });
            if (notes.trim()) {
              await createNote(lead.id, { body: notes.trim() });
            }
            router.push('/field');
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Customer name</span>
            <input
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Phone</span>
            <input
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Address</span>
            <input
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">City</span>
            <input
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Notes (optional)</span>
            <textarea
              className="h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            className="w-full"
            disabled={createLead.isPending || (!name.trim() && !phone.trim())}
          >
            {createLead.isPending ? 'Saving…' : 'Save lead'}
          </Button>
          <ErrorNote error={createLead.error} />
        </form>
      </Card>
    </section>
  );
}
