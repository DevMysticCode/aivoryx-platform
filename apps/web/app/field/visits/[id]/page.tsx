'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { captureLocation } from '@/lib/field/geolocation';
import {
  useCheckInVisit,
  useCheckOutVisit,
  useCompleteVisit,
  useCreateVisitNote,
  useDeleteVisitAttachment,
  useSubmitVisitSurvey,
  useUploadVisitAttachment,
  useVisit,
  useVisitAttachments,
  useVisitNotes,
  useVisitSurvey,
} from '@/lib/field/use-field';
import { Card, ErrorNote, Skeleton, StatusBadge } from '@/components/admin/ui';
import { AttachmentThumb } from '@/components/field/attachment-thumb';

type SurveyValue = string | number | boolean | null;

function draftKey(visitId: string): string {
  return `aivoryx.field.survey-draft.${visitId}`;
}

/** Read a locally-saved, not-yet-submitted survey draft — resilience against a
 *  temporary network failure (ADR 0033 §12), not a full offline sync engine. */
function loadDraft(visitId: string): Record<string, SurveyValue> {
  try {
    const raw = localStorage.getItem(draftKey(visitId));
    return raw ? (JSON.parse(raw) as Record<string, SurveyValue>) : {};
  } catch {
    return {};
  }
}

function saveDraft(visitId: string, values: Record<string, SurveyValue>): void {
  try {
    localStorage.setItem(draftKey(visitId), JSON.stringify(values));
  } catch {
    // best-effort only — storage may be unavailable (private browsing, quota)
  }
}

function clearDraft(visitId: string): void {
  try {
    localStorage.removeItem(draftKey(visitId));
  } catch {
    // best-effort
  }
}

export default function FieldVisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const visit = useVisit(id);
  const survey = useVisitSurvey(id);
  const notes = useVisitNotes(id);
  const attachments = useVisitAttachments(id);

  const checkIn = useCheckInVisit(id);
  const checkOut = useCheckOutVisit(id);
  const complete = useCompleteVisit(id);
  const submitSurvey = useSubmitVisitSurvey(id);
  const createNote = useCreateVisitNote(id);
  const uploadAttachment = useUploadVisitAttachment(id);
  const deleteAttachment = useDeleteVisitAttachment(id);

  const [locationError, setLocationError] = useState<string | null>(null);
  const [surveyValues, setSurveyValues] = useState<Record<string, SurveyValue>>({});
  const [draftRestored, setDraftRestored] = useState(false);
  const [travelKm, setTravelKm] = useState('');
  const [travelNotes, setTravelNotes] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'failed'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore whatever the agent typed before a reload/temporary disconnect, then
  // apply the server's saved values on top (server wins once it has an answer).
  useEffect(() => {
    if (draftRestored || !survey.data) return;
    const draft = loadDraft(id);
    const fromServer: Record<string, SurveyValue> = {};
    for (const f of survey.data) fromServer[f.key] = f.value;
    setSurveyValues({ ...draft, ...fromServer });
    setDraftRestored(true);
  }, [id, survey.data, draftRestored]);

  if (visit.isLoading) return <Skeleton rows={6} />;
  if (visit.error) return <ErrorNote error={visit.error} />;
  if (!visit.data) return null;

  const v = visit.data;
  const missing =
    complete.error instanceof ApiError
      ? ((complete.error.body?.error.details as { missing?: string[] } | undefined)?.missing ?? [])
      : [];

  const updateSurveyValue = (key: string, value: SurveyValue) => {
    const next = { ...surveyValues, [key]: value };
    setSurveyValues(next);
    saveDraft(id, next);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{v.leadName ?? 'Site visit'}</h1>
          <p className="text-sm text-muted-foreground">
            {v.leadPhone ?? ''} {v.addressLine ? `· ${v.addressLine}` : ''}
          </p>
        </div>
        <StatusBadge status={v.status} />
      </div>

      {/* 1. CHECK IN */}
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Check in</h2>
        {v.checkInAt ? (
          <p className="text-sm text-muted-foreground">
            Checked in {new Date(v.checkInAt).toLocaleString()}
            {v.checkInAccuracyM != null ? ` (±${Math.round(v.checkInAccuracyM)}m)` : ''}
          </p>
        ) : (
          <>
            <Button
              disabled={v.status !== 'ASSIGNED' || checkIn.isPending}
              onClick={async () => {
                setLocationError(null);
                try {
                  const point = await captureLocation();
                  await checkIn.mutateAsync(point);
                } catch (err) {
                  setLocationError(err instanceof Error ? err.message : 'Could not check in.');
                }
              }}
            >
              {checkIn.isPending ? 'Getting your location…' : 'Check in'}
            </Button>
            {v.status !== 'ASSIGNED' ? (
              <p className="text-xs text-muted-foreground">
                This visit is not currently assigned/ready for check-in.
              </p>
            ) : null}
          </>
        )}
        {locationError ? <ErrorNote error={new Error(locationError)} /> : null}
        <ErrorNote error={checkIn.error} />
      </Card>

      {v.checkInAt ? (
        <>
          {/* 2. SURVEY */}
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Site survey</h2>
            {survey.isLoading ? (
              <Skeleton rows={3} />
            ) : survey.data && survey.data.length > 0 ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitSurvey.mutate(
                    { values: surveyValues },
                    { onSuccess: () => clearDraft(id) },
                  );
                }}
              >
                {survey.data.map((f) => (
                  <label key={f.key} className="block space-y-1.5">
                    <span className="text-sm font-medium">
                      {f.label}
                      {f.isRequired ? <span className="text-destructive"> *</span> : null}
                    </span>
                    <SurveyInput
                      dataType={f.dataType}
                      options={f.options}
                      value={surveyValues[f.key] ?? null}
                      onChange={(val) => updateSurveyValue(f.key, val)}
                    />
                  </label>
                ))}
                <Button type="submit" size="sm" disabled={submitSurvey.isPending}>
                  {submitSurvey.isPending ? 'Saving…' : 'Save survey'}
                </Button>
                {!submitSurvey.isPending && !submitSurvey.isError && submitSurvey.isSuccess ? (
                  <span className="ml-2 text-xs text-muted-foreground">Saved</span>
                ) : null}
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">No survey questions configured.</p>
            )}
            <ErrorNote error={submitSurvey.error} />
          </Card>

          {/* 3. PHOTOS */}
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Photos</h2>
            <div className="flex flex-wrap gap-3">
              {(attachments.data ?? []).map((a) => (
                <div key={a.id} className="relative">
                  <AttachmentThumb visitId={id} attachment={a} />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-destructive text-xs text-destructive-foreground"
                    onClick={() => deleteAttachment.mutate(a.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploadState('uploading');
                try {
                  await uploadAttachment.mutateAsync(file);
                  setUploadState('idle');
                } catch {
                  setUploadState('failed');
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={uploadState === 'uploading'}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadState === 'uploading' ? 'Uploading…' : 'Add photo'}
            </Button>
            {uploadState === 'failed' ? (
              <p className="text-xs text-destructive">
                Upload failed — check your connection and try again.
              </p>
            ) : null}
          </Card>

          {/* 4. NOTES */}
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteBody.trim()) return;
                createNote.mutate({ body: noteBody });
                setNoteBody('');
              }}
              className="space-y-2"
            >
              <textarea
                className="h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm"
                placeholder="Add a note about this visit…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <Button size="sm" type="submit" disabled={createNote.isPending || !noteBody.trim()}>
                Add note
              </Button>
            </form>
            <ul className="space-y-2 text-sm">
              {(notes.data ?? []).map((n) => (
                <li key={n.id} className="rounded border p-2">
                  {n.body}
                </li>
              ))}
            </ul>
          </Card>

          {/* 5. TRAVEL + 6. CHECK OUT */}
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Travel &amp; check out</h2>
            {v.checkOutAt ? (
              <p className="text-sm text-muted-foreground">
                Checked out {new Date(v.checkOutAt).toLocaleString()}
                {v.gpsDistanceMeters != null
                  ? ` · ${Math.round(v.gpsDistanceMeters)}m straight-line from site`
                  : ''}
              </p>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Travel distance (km, optional)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={travelKm}
                    onChange={(e) => setTravelKm(e.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Travel notes (optional)</span>
                  <input
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={travelNotes}
                    onChange={(e) => setTravelNotes(e.target.value)}
                  />
                </label>
                <Button
                  disabled={checkOut.isPending}
                  onClick={async () => {
                    setLocationError(null);
                    try {
                      const point = await captureLocation();
                      await checkOut.mutateAsync({
                        ...point,
                        travelKm: travelKm ? Number(travelKm) : undefined,
                        travelNotes: travelNotes || undefined,
                      });
                    } catch (err) {
                      setLocationError(err instanceof Error ? err.message : 'Could not check out.');
                    }
                  }}
                >
                  {checkOut.isPending ? 'Getting your location…' : 'Check out'}
                </Button>
                {locationError ? <ErrorNote error={new Error(locationError)} /> : null}
                <ErrorNote error={checkOut.error} />
              </>
            )}
          </Card>

          {/* 7. COMPLETE */}
          <Card className="space-y-2">
            <h2 className="text-sm font-semibold">Complete visit</h2>
            {v.status === 'COMPLETED' ? (
              <p className="text-sm text-muted-foreground">This visit is complete.</p>
            ) : (
              <>
                <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
                  {complete.isPending ? 'Completing…' : 'Mark visit complete'}
                </Button>
                {missing.length > 0 ? (
                  <p className="text-xs text-destructive">
                    Still missing: {missing.join(', ').replace(/_/g, ' ')}
                  </p>
                ) : (
                  <ErrorNote error={complete.error} />
                )}
              </>
            )}
          </Card>
        </>
      ) : null}
    </section>
  );
}

function SurveyInput({
  dataType,
  options,
  value,
  onChange,
}: {
  dataType: string;
  options: string[] | null;
  value: SurveyValue;
  onChange: (value: SurveyValue) => void;
}) {
  if (dataType === 'select') {
    return (
      <select
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Select…</option>
        {(options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (dataType === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4"
      />
    );
  }
  if (dataType === 'number') {
    return (
      <input
        type="number"
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  if (dataType === 'date') {
    return (
      <input
        type="date"
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }
  return (
    <input
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
