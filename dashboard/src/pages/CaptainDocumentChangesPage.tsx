import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchCaptainDocumentChangeQueue, getCaptainDocumentPreviewUrl, reviewCaptainDocumentChange, verifyCaptainDocument } from '@/lib/api';
import type { CaptainDocumentChangeQueueRow } from '@/lib/types';
import { formatDateTime, titleize } from '@/lib/format';

export function CaptainDocumentChangesPage() {
  const queryClient = useQueryClient();
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const queue = useQuery({ queryKey: ['captain-document-changes'], queryFn: fetchCaptainDocumentChangeQueue });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['captain-document-changes'] });
  const reviewChange = useMutation({ mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => reviewCaptainDocumentChange(id, approve, note), onSuccess: refresh, onSettled: () => setBusyDocument(null) });
  const verifyReplacement = useMutation({ mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => verifyCaptainDocument(id, approve, note), onSuccess: refresh, onSettled: () => setBusyDocument(null) });
  const openPreview = async (row: CaptainDocumentChangeQueueRow) => {
    if (!row.storage_path) return;
    setBusyDocument(row.document_id);
    try { window.open(await getCaptainDocumentPreviewUrl(row.storage_path), '_blank', 'noopener,noreferrer'); }
    finally { setBusyDocument(null); }
  };
  const decide = (row: CaptainDocumentChangeQueueRow, approve: boolean) => {
    const isReplacement = row.change_request_status === 'approved' && row.verification_status === 'pending';
    const note = window.prompt(approve ? (isReplacement ? 'Verification note (optional)' : 'Approval note (optional)') : 'Reason for rejection (recommended)');
    if (note === null) return;
    setBusyDocument(row.document_id);
    (isReplacement ? verifyReplacement : reviewChange).mutate({ id: row.document_id, approve, note });
  };

  return <div className="space-y-6">
    <PageHeader title="Captain Document Changes" subtitle="Approve a verified-document replacement request, then verify the submitted replacement." />
    <Card>{queue.isLoading ? <LoadingBlock label="Loading document changes…" /> : queue.error ? <ErrorBlock error={queue.error} /> : <DataTable<CaptainDocumentChangeQueueRow>
      data={queue.data ?? []}
      emptyMessage="No document changes need review."
      columns={[
        { header: 'Captain', accessorFn: (row) => row.captain_name ?? row.captain_id.slice(0, 8), cell: (cell) => <div><div className="font-medium text-slate-800">{cell.getValue<string>()}</div><div className="text-xs text-slate-400">{cell.row.original.captain_phone ?? '—'}</div></div> },
        { header: 'Document', accessorFn: (row) => row.document_type, cell: (cell) => titleize(cell.getValue<string>()) },
        { header: 'Change status', accessorFn: (row) => row.change_request_status, cell: (cell) => <StatusBadge value={cell.getValue<string>()} /> },
        { header: 'Verification', accessorFn: (row) => row.verification_status, cell: (cell) => <StatusBadge value={cell.getValue<string>()} /> },
        { header: 'Submitted', accessorFn: (row) => row.replacement_submitted_at ?? row.change_requested_at, cell: (cell) => cell.getValue<string | null>() ? formatDateTime(cell.getValue<string>()) : '—' },
        { header: 'Current note', accessorFn: (row) => row.review_note ?? '—', enableSorting: false },
        { header: '', id: 'actions', enableSorting: false, cell: (cell) => {
          const row = cell.row.original;
          const isReplacement = row.change_request_status === 'approved' && row.verification_status === 'pending';
          const pending = busyDocument === row.document_id;
          return <div className="flex flex-wrap justify-end gap-1.5">
            {row.storage_path ? <button disabled={pending} onClick={() => { void openPreview(row); }} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40">View</button> : null}
            <button disabled={pending} onClick={() => decide(row, true)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">{isReplacement ? 'Verify' : 'Approve change'}</button>
            <button disabled={pending} onClick={() => decide(row, false)} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Reject</button>
          </div>;
        } },
      ]}
    />}</Card>
    {reviewChange.error || verifyReplacement.error ? <ErrorBlock error={reviewChange.error ?? verifyReplacement.error} /> : null}
  </div>;
}
