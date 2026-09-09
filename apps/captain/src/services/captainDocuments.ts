import { supabase } from '../lib/supabase';

export type CaptainDocumentType = 'license' | 'rc' | 'insurance';
export type CaptainManagedDocument = {
  id: string; document_type: CaptainDocumentType; verification_status: 'pending' | 'verified' | 'rejected' | 'reupload_required';
  change_request_status: 'none' | 'requested' | 'approved' | 'rejected'; review_note: string | null;
};
export type ReplacementFile = { uri: string; name: string };

const types: CaptainDocumentType[] = ['license', 'rc', 'insurance'];
const contentType = (name: string) => name.toLowerCase().endsWith('.png') ? 'image/png' : name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
const requireClient = () => { if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED'); return supabase; };

async function currentUserId() {
  const { data: { user }, error } = await requireClient().auth.getUser();
  if (error || !user) throw error ?? new Error('AUTHENTICATION_REQUIRED');
  return user.id;
}

export const captainDocumentsService = {
  async list() {
    const client = requireClient();
    const { data, error } = await client.from('captain_onboarding_documents')
      .select('id, document_type, verification_status, change_request_status, review_note')
      .order('document_type');
    if (error) throw error;
    const byType = new Map((data ?? []).map((document) => [document.document_type, document as CaptainManagedDocument]));
    return types.map((type) => byType.get(type)).filter((document): document is CaptainManagedDocument => Boolean(document));
  },
  async requestChange(documentId: string) {
    const { error } = await requireClient().rpc('captain_request_document_change', { p_document_id: documentId });
    if (error) throw error;
  },
  async submitReplacement(document: CaptainManagedDocument, file: ReplacementFile) {
    const client = requireClient(); const userId = await currentUserId();
    const response = await fetch(file.uri); const binary = await response.arrayBuffer();
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${userId}/${document.document_type}-${Date.now()}.${extension}`;
    const { error: uploadError } = await client.storage.from('captain-documents').upload(path, binary, { contentType: contentType(file.name), upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await client.rpc('captain_submit_document_replacement', { p_document_id: document.id, p_storage_path: path });
    if (error) throw error;
  },
};
