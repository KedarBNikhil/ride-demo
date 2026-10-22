import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "*",
};

const requiredTypes = ["license", "rc", "insurance"] as const;
type DocumentType = (typeof requiredTypes)[number];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(buffer: ArrayBuffer) {
  return toHex(await crypto.subtle.digest("SHA-256", buffer));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return json({ error: "Server configuration error" }, 500);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Authentication required" }, 401);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pilotError } = await admin.rpc("assert_pilot_identity_for_user", {
    p_user_id: user.id,
    p_app_variant: "captain",
  });
  if (pilotError) return json({ error: "Captain pilot access is not active" }, 403);

  const [{ data: programRows, error: programError }, { data: templates, error: templateError }, { data: application, error: applicationError }] = await Promise.all([
    admin.rpc("test_captain_document_program_for_service"),
    admin.rpc("test_captain_document_templates_for_service"),
    admin.from("captain_onboarding_applications").select("id, status").eq("user_id", user.id).maybeSingle(),
  ]);
  if (programError || templateError || applicationError) return json({ error: "Could not inspect test approval state" }, 500);
  const program = programRows?.[0];
  if (!program?.enabled || new Date(program.ends_at).getTime() <= Date.now()) return json({ autoApproved: false, reason: "program_inactive" });
  if (application?.status === "approved") return json({ autoApproved: true, alreadyApproved: true });
  if (!application || application.status !== "submitted") return json({ autoApproved: false, reason: "application_not_submitted" });

  const expected = new Map((templates ?? []).map((template) => [template.document_type, template.sha256]));
  if (expected.size !== requiredTypes.length || requiredTypes.some((type) => !expected.has(type))) return json({ error: "Test document templates are incomplete" }, 500);

  const { data: documents, error: documentsError } = await admin
    .from("captain_onboarding_documents")
    .select("id, document_type, storage_path")
    .eq("user_id", user.id);
  if (documentsError) return json({ error: "Could not inspect uploaded documents" }, 500);
  const byType = new Map((documents ?? []).map((document) => [document.document_type, document]));
  if (requiredTypes.some((type) => !byType.has(type))) return json({ autoApproved: false, reason: "incomplete_document_set" });

  const hashes: Record<DocumentType, string> = {} as Record<DocumentType, string>;
  for (const type of requiredTypes) {
    const document = byType.get(type)!;
    const { data: blob, error: downloadError } = await admin.storage.from("captain-documents").download(document.storage_path);
    if (downloadError || !blob) return json({ error: "Could not read an uploaded document" }, 500);
    hashes[type] = await sha256(await blob.arrayBuffer());
  }
  if (requiredTypes.some((type) => hashes[type] !== expected.get(type))) return json({ autoApproved: false, reason: "documents_do_not_match" });

  const { data: approved, error: approvalError } = await admin.rpc("finalize_test_captain_document_approval", {
    p_user_id: user.id,
    p_application_id: application.id,
    p_document_hashes: hashes,
  });
  if (approvalError || !approved) return json({ error: "Could not approve test Captain" }, 500);

  return json({ autoApproved: true });
});
