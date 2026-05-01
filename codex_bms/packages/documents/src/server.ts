import {
  authorizeOrThrow,
  hashPublicLinkToken,
  issueSignedPublicLinkToken,
  materializeResolvedPublicLink,
  tokenPrefix,
  verifySignedPublicLinkToken
} from "../../auth/src/server/index.ts";
import { enforceRetentionPolicy } from "../../security/src/index.ts";
import type {
  AuditEvent,
  AuthorizationActor,
  DocumentAccessAction,
  DocumentActivitySummary,
  DocumentDownloadResult,
  DocumentPreviewResult,
  DocumentRecord,
  DocumentVersionRecord,
  RoleKey,
  VisibilityFlag
} from "../../types/src/index.ts";
import {
  authorizeDocumentMutationOrThrow,
  authorizeDocumentUploadOrThrow,
  authorizeDocumentVersionUploadOrThrow,
  authorizeDocumentView,
  authorizeDocumentViewOrThrow,
  documentAccessRulesAllow,
  toDocumentResourceRecord
} from "./authorization.ts";
import type { DocumentsRuntime } from "./runtime.ts";
import type {
  CreateDocumentPublicShareLinkInput,
  ReplaceDocumentAccessRulesInput,
  SetDocumentArchiveStateInput,
  UpdateDocumentVisibilityInput,
  UploadDocumentInput
} from "./workflow.ts";

const ROLE_VISIBILITY_ACCESS: Record<RoleKey, readonly VisibilityFlag[]> = {
  owner: ["internal", "customer", "subcontractor", "supercontractor", "public_link"],
  administrator: ["internal", "customer", "subcontractor", "supercontractor", "public_link"],
  developer: ["internal"],
  employee: ["internal", "customer", "subcontractor", "supercontractor", "public_link"],
  applicant: [],
  customer: ["customer", "public_link"],
  subcontractor: ["subcontractor", "public_link"],
  supercontractor: ["subcontractor", "supercontractor", "public_link"]
};

export class DocumentAccessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentAccessRuleError";
  }
}

function actorVisibleFlags(actor: AuthorizationActor | undefined): readonly VisibilityFlag[] {
  if (!actor) {
    return [];
  }

  return [...new Set(actor.memberships.flatMap((membership) => ROLE_VISIBILITY_ACCESS[membership.role] ?? []))];
}

function actorHasPrivilegedRole(actor: AuthorizationActor | undefined): boolean {
  if (!actor) {
    return false;
  }

  return actor.memberships.some((membership) => membership.role === "owner" || membership.role === "administrator");
}

function filterActivities(
  activities: readonly DocumentActivitySummary[],
  allowedFlags: readonly VisibilityFlag[]
): readonly DocumentActivitySummary[] {
  return activities.filter((activity) => activity.visibilityFlags.some((flag) => allowedFlags.includes(flag)));
}

function ensureAccessRulesAllow(
  actor: AuthorizationActor | undefined,
  action: DocumentAccessAction,
  rules: ReturnType<DocumentsRuntime["repository"]["listAccessRulesByDocumentId"]>
): void {
  if (!documentAccessRulesAllow(actor, rules, action)) {
    throw new DocumentAccessRuleError(`Document access rules deny the ${action} action.`);
  }
}

function buildPublicLinkAuditEvent(
  eventType: AuditEvent["eventType"],
  documentId: string,
  occurredAt: string,
  actorUserId?: string | null,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    eventType,
    outcome: eventType === "public_link.issue" ? "issued" : eventType === "public_link.revoke" ? "revoked" : "success",
    actorUserId: actorUserId ?? null,
    resourceType: "document",
    resourceId: documentId,
    viaPublicLink: eventType === "public_link.access",
    sensitive: true,
    occurredAt,
    metadata
  };
}

function getLatestVersionOrThrow(runtime: DocumentsRuntime, document: DocumentRecord): DocumentVersionRecord {
  const version = runtime.repository.getVersionById(document.latestVersionId);

  if (!version) {
    throw new Error(`Latest version ${document.latestVersionId} was not found.`);
  }

  if (version.malwareStatus !== "clean") {
    throw new Error(`Latest version ${version.id} is not available because malware status is ${version.malwareStatus}.`);
  }

  return version;
}

export async function listVisibleDocumentsForActor(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly DocumentRecord[]> {
  const visible: DocumentRecord[] = [];

  for (const document of runtime.service.listDocuments()) {
    const decision = await authorizeDocumentView(actor, document, runtime.auditSink);

    if (!decision.allowed) {
      continue;
    }

    const rules = runtime.repository.listAccessRulesByDocumentId(document.id);

    if (!documentAccessRulesAllow(actor, rules, "view")) {
      continue;
    }

    visible.push(document);
  }

  return visible;
}

export async function getDocumentDetailForActor(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  documentId: string
): Promise<{
  document?: DocumentRecord;
  versions: readonly DocumentVersionRecord[];
  accessRules: ReturnType<DocumentsRuntime["repository"]["listAccessRulesByDocumentId"]>;
  activities: readonly DocumentActivitySummary[];
  publicShareLinks: ReturnType<DocumentsRuntime["repository"]["listPublicShareLinksByDocumentId"]>;
}> {
  const detail = runtime.service.getDocumentDetail(documentId);

  if (!detail.document) {
    return detail;
  }

  await authorizeDocumentViewOrThrow(actor, detail.document, runtime.auditSink);
  ensureAccessRulesAllow(actor, "view", detail.accessRules);

  const allowedFlags = actorVisibleFlags(actor);

  return {
    document: detail.document,
    versions: detail.versions,
    accessRules: actorHasPrivilegedRole(actor) ? detail.accessRules : [],
    activities: filterActivities(detail.activities, allowedFlags),
    publicShareLinks: actorHasPrivilegedRole(actor) ? detail.publicShareLinks : []
  };
}

export async function prepareDocumentPreviewForActor(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  documentId: string
): Promise<DocumentPreviewResult> {
  const document = runtime.repository.getDocumentById(documentId);

  if (!document) {
    throw new Error(`Document ${documentId} was not found.`);
  }

  await authorizeDocumentViewOrThrow(actor, document, runtime.auditSink);
  ensureAccessRulesAllow(actor, "view", runtime.repository.listAccessRulesByDocumentId(document.id));
  const version = getLatestVersionOrThrow(runtime, document);
  const previewUrl = await runtime.storage.buildPreviewUrl({
    key: version.storageKey
  });

  return {
    document,
    version,
    previewUrl
  };
}

export async function prepareDocumentDownloadForActor(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  documentId: string
): Promise<DocumentDownloadResult> {
  const document = runtime.repository.getDocumentById(documentId);

  if (!document) {
    throw new Error(`Document ${documentId} was not found.`);
  }

  await authorizeDocumentViewOrThrow(actor, document, runtime.auditSink);
  ensureAccessRulesAllow(actor, "download", runtime.repository.listAccessRulesByDocumentId(document.id));
  const version = getLatestVersionOrThrow(runtime, document);
  const downloadUrl = await runtime.storage.buildDownloadUrl({
    key: version.storageKey,
    fileName: version.fileName
  });

  return {
    document,
    version,
    downloadUrl
  };
}

export async function uploadDocumentServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: UploadDocumentInput
): Promise<DocumentRecord> {
  await authorizeDocumentUploadOrThrow(actor, input, runtime.auditSink);
  return runtime.service.uploadDocument(input);
}

export async function uploadDocumentVersionServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: {
    documentId: string;
    actorUserId: string;
    file: UploadDocumentInput["file"];
  }
) {
  const document = runtime.repository.getDocumentById(input.documentId);

  if (!document) {
    throw new Error(`Document ${input.documentId} was not found.`);
  }

  await authorizeDocumentVersionUploadOrThrow(actor, document, runtime.auditSink);
  ensureAccessRulesAllow(actor, "upload", runtime.repository.listAccessRulesByDocumentId(document.id));
  return runtime.service.uploadDocumentVersion(input);
}

export async function replaceDocumentAccessRulesServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: ReplaceDocumentAccessRulesInput
) {
  const document = runtime.repository.getDocumentById(input.documentId);

  if (!document) {
    throw new Error(`Document ${input.documentId} was not found.`);
  }

  await authorizeDocumentMutationOrThrow(actor, "document.access.manage.org", document, runtime.auditSink);
  return runtime.service.replaceDocumentAccessRules(input);
}

export async function setDocumentArchiveStateServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: SetDocumentArchiveStateInput & {
    approvalId?: string;
  }
) {
  const document = runtime.repository.getDocumentById(input.documentId);

  if (!document) {
    throw new Error(`Document ${input.documentId} was not found.`);
  }

  await authorizeDocumentMutationOrThrow(actor, "document.archive.manage.org", document, runtime.auditSink);

  if (input.archiveState === "archived" && document.retentionFlags.length > 0) {
    const occurredAt = runtime.now().toISOString();
    await runtime.security.approvals.assertApproved({
      approvalId: input.approvalId,
      actionKey: "document.archive.retained",
      actorUserId: input.actorUserId,
      resourceType: "document",
      resourceId: document.id,
      now: runtime.now()
    });
    await enforceRetentionPolicy({
      policy: {
        policyKey: "document_archive_retention_guard",
        resourceType: "document",
        resourceId: document.id,
        actorUserId: input.actorUserId,
        retentionFlags: document.retentionFlags
      },
      auditSink: runtime.auditSink,
      logger: runtime.security.logger,
      monitoringHook: runtime.security.monitoringHook,
      occurredAt,
      metadata: {
        requestedArchiveState: input.archiveState
      }
    });
  }

  return runtime.service.setDocumentArchiveState(input);
}

export async function updateDocumentVisibilityServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateDocumentVisibilityInput
) {
  const document = runtime.repository.getDocumentById(input.documentId);

  if (!document) {
    throw new Error(`Document ${input.documentId} was not found.`);
  }

  await authorizeDocumentMutationOrThrow(actor, "document.visibility.manage.org", document, runtime.auditSink);
  return runtime.service.updateDocumentVisibility(input);
}

export async function issueDocumentPublicShareLinkServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: Omit<CreateDocumentPublicShareLinkInput, "tokenHash" | "tokenPrefix" | "permissionKeys" | "linkId"> & {
    shareScope: CreateDocumentPublicShareLinkInput["shareScope"];
    approvalId?: string;
  }
) {
  const document = runtime.repository.getDocumentById(input.documentId);

  if (!document) {
    throw new Error(`Document ${input.documentId} was not found.`);
  }

  await authorizeDocumentMutationOrThrow(actor, "public_link.issue.org", document, runtime.auditSink);
  await runtime.security.approvals.assertApproved({
    approvalId: input.approvalId,
    actionKey: "public_link.issue",
    actorUserId: input.actorUserId,
    resourceType: "document",
    resourceId: document.id,
    now: runtime.now()
  });
  const occurredAt = runtime.now().toISOString();
  const linkId = `document-link-${hashPublicLinkToken(`${document.id}:${input.expiresAt}:${occurredAt}`).slice(0, 12)}`;
  const payload = {
    linkId,
    resourceType: "document",
    resourceId: document.id,
    permissionKeys: ["document.view.public_link"] as const,
    expiresAt: input.expiresAt,
    nonce: hashPublicLinkToken(`${document.id}:${input.actorUserId}:${occurredAt}`).slice(0, 24),
    issuedAt: occurredAt
  };
  const token = issueSignedPublicLinkToken(payload, runtime.publicLinkSecret, {
    auditSink: runtime.auditSink,
    logger: runtime.security.logger,
    monitoringHook: runtime.security.monitoringHook,
    resourceType: "document",
    resourceId: document.id
  });
  const link = await runtime.service.createDocumentPublicShareLink({
    documentId: document.id,
    linkId,
    actorUserId: input.actorUserId,
    permissionKeys: payload.permissionKeys,
    shareScope: input.shareScope,
    tokenHash: hashPublicLinkToken(token),
    tokenPrefix: tokenPrefix(token),
    expiresAt: input.expiresAt,
    maxUses: input.maxUses
  });
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.issue", document.id, occurredAt, input.actorUserId, {
      linkId: link.id,
      shareScope: link.shareScope,
      expiresAt: link.expiresAt
    })
  );

  return { link, token };
}

export async function revokeDocumentPublicShareLinkServer(
  runtime: DocumentsRuntime,
  actor: AuthorizationActor | undefined,
  input: {
    linkId: string;
    actorUserId: string;
  }
) {
  const link = runtime.repository.getPublicShareLinkById(input.linkId);

  if (!link) {
    throw new Error(`Public link ${input.linkId} was not found.`);
  }

  const document = runtime.repository.getDocumentById(link.documentId);

  if (!document) {
    throw new Error(`Document ${link.documentId} was not found.`);
  }

  await authorizeDocumentMutationOrThrow(actor, "public_link.revoke.org", document, runtime.auditSink);
  const updated = await runtime.service.revokeDocumentPublicShareLink(input);
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.revoke", document.id, updated.revokedAt ?? runtime.now().toISOString(), input.actorUserId, {
      linkId: updated.id
    })
  );
  return updated;
}

async function resolvePublicDocumentLink(
  runtime: DocumentsRuntime,
  token: string,
  now: Date
) {
  const verified = verifySignedPublicLinkToken(token, runtime.publicLinkSecret, now, {
    auditSink: runtime.auditSink,
    logger: runtime.security.logger,
    monitoringHook: runtime.security.monitoringHook,
    resourceType: "document"
  });

  if (!verified.valid || !verified.payload) {
    throw new Error(`Public link token is invalid: ${verified.reason ?? "unknown"}.`);
  }

  const link = runtime.repository.getPublicShareLinkById(verified.payload.linkId);

  if (!link || link.tokenHash !== hashPublicLinkToken(token)) {
    throw new Error("Public link record was not found.");
  }

  const document = runtime.repository.getDocumentById(link.documentId);

  if (!document) {
    throw new Error(`Document ${link.documentId} was not found.`);
  }

  await authorizeOrThrow(
    {
      permissionKey: "document.view.public_link",
      record: toDocumentResourceRecord(document),
      publicLink: materializeResolvedPublicLink({
        id: link.id,
        resourceType: "document",
        resourceId: document.id,
        permissionKeys: link.permissionKeys,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        maxUses: link.maxUses,
        useCount: link.useCount
      }),
      now
    },
    runtime.auditSink
  );

  return {
    link,
    document,
    version: getLatestVersionOrThrow(runtime, document)
  };
}

export async function previewDocumentViaPublicLinkServer(
  runtime: DocumentsRuntime,
  token: string,
  now = new Date()
): Promise<DocumentPreviewResult> {
  const { link, document, version } = await resolvePublicDocumentLink(runtime, token, now);

  if (link.shareScope !== "preview" && link.shareScope !== "preview_download") {
    throw new Error("Public link scope does not allow preview access.");
  }

  const previewUrl = await runtime.storage.buildPreviewUrl({
    key: version.storageKey,
    expiresAt: link.expiresAt
  });

  runtime.repository.updatePublicShareLink({
    ...link,
    useCount: link.useCount + 1
  });
  runtime.service.recordDocumentPublicShareAccess(document.id);
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.access", document.id, now.toISOString(), null, {
      linkId: link.id,
      shareScope: link.shareScope,
      accessType: "preview"
    })
  );

  return {
    document,
    version,
    previewUrl
  };
}

export async function downloadDocumentViaPublicLinkServer(
  runtime: DocumentsRuntime,
  token: string,
  now = new Date()
): Promise<DocumentDownloadResult> {
  const { link, document, version } = await resolvePublicDocumentLink(runtime, token, now);

  if (link.shareScope !== "download" && link.shareScope !== "preview_download") {
    throw new Error("Public link scope does not allow download access.");
  }

  const downloadUrl = await runtime.storage.buildDownloadUrl({
    key: version.storageKey,
    fileName: version.fileName,
    expiresAt: link.expiresAt
  });

  runtime.repository.updatePublicShareLink({
    ...link,
    useCount: link.useCount + 1
  });
  runtime.service.recordDocumentPublicShareAccess(document.id);
  runtime.auditSink.write(
    buildPublicLinkAuditEvent("public_link.access", document.id, now.toISOString(), null, {
      linkId: link.id,
      shareScope: link.shareScope,
      accessType: "download"
    })
  );

  return {
    document,
    version,
    downloadUrl
  };
}
