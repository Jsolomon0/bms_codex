import type {
  AuditEvent,
  AuditSink,
  DocumentAccessRuleRecord,
  DocumentActivitySummary,
  DocumentArchiveState,
  DocumentDownloadResult,
  DocumentPublicShareLinkRecord,
  DocumentRecord,
  DocumentRepository,
  DocumentRetentionFlag,
  DocumentShareScope,
  DocumentUploadEnvelope,
  DocumentVersionRecord,
  DocumentVersionUploadEnvelope,
  PermissionKey,
  VisibilityFlag
} from "../../types/src/index.ts";
import type { MalwareScanHook, ObjectStorageAdapter } from "../../storage/src/index.ts";
import { NoopMalwareScanHook } from "../../storage/src/index.ts";
import {
  ensureArchiveStateChangeAllowed,
  DocumentValidationError,
  DocumentWorkflowError,
  validateDocumentAccessRules,
  validateDocumentRetentionFlags,
  validateDocumentShareScope,
  validateDocumentUploadInput,
  validateDocumentVisibility
} from "./validation.ts";

function defaultIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))];
}

function defaultRetentionFlagsForCategory(category: DocumentUploadEnvelope["category"]): readonly DocumentRetentionFlag[] {
  switch (category) {
    case "receipts":
    case "invoices":
      return ["accounting_required"];
    case "payroll_docs":
      return ["payroll_required"];
    case "tax_docs":
      return ["tax_required"];
    case "customer_uploads":
      return ["customer_record_required"];
    default:
      return [];
  }
}

function buildStorageKey(documentId: string, versionNumber: number, fileName: string): string {
  const normalized = fileName.trim().replace(/\s+/g, "-").toLowerCase();
  return `documents/${documentId}/v${versionNumber}/${normalized}`;
}

function createAuditEvent(
  occurredAt: string,
  eventType: AuditEvent["eventType"],
  resourceType: string,
  resourceId: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>
): AuditEvent {
  return {
    eventType,
    outcome: "success",
    actorUserId,
    resourceType,
    resourceId,
    viaPublicLink: false,
    sensitive: true,
    occurredAt,
    metadata
  };
}

function createActivity(
  idGenerator: (prefix: string) => string,
  input: Omit<DocumentActivitySummary, "id">
): DocumentActivitySummary {
  return {
    id: idGenerator("document-activity"),
    ...input
  };
}

export interface UploadDocumentInput extends DocumentUploadEnvelope {
  actorUserId: string;
}

export interface ReplaceDocumentAccessRulesInput {
  documentId: string;
  actorUserId: string;
  rules: readonly Omit<DocumentAccessRuleRecord, "id" | "documentId" | "createdAt" | "createdByUserId">[];
}

export interface SetDocumentArchiveStateInput {
  documentId: string;
  actorUserId: string;
  archiveState: DocumentArchiveState;
}

export interface UpdateDocumentVisibilityInput {
  documentId: string;
  actorUserId: string;
  visibilityFlags: readonly VisibilityFlag[];
}

export interface CreateDocumentPublicShareLinkInput {
  documentId: string;
  linkId?: string;
  actorUserId: string;
  permissionKeys: readonly PermissionKey[];
  shareScope: DocumentShareScope;
  tokenHash: string;
  tokenPrefix: string;
  expiresAt: string;
  maxUses?: number | null;
}

export interface RevokeDocumentPublicShareLinkInput {
  linkId: string;
  actorUserId: string;
}

export interface DocumentDetail {
  document?: DocumentRecord;
  versions: readonly DocumentVersionRecord[];
  accessRules: readonly DocumentAccessRuleRecord[];
  activities: readonly DocumentActivitySummary[];
  publicShareLinks: readonly DocumentPublicShareLinkRecord[];
}

export interface DocumentWorkflowDependencies {
  repository: DocumentRepository;
  storage: ObjectStorageAdapter;
  malwareScanHook?: MalwareScanHook;
  auditSink?: AuditSink;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

export class DocumentManagementService {
  private readonly repository: DocumentRepository;
  private readonly storage: ObjectStorageAdapter;
  private readonly malwareScanHook: MalwareScanHook;
  private readonly auditSink?: AuditSink;
  private readonly idGenerator: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(dependencies: DocumentWorkflowDependencies) {
    this.repository = dependencies.repository;
    this.storage = dependencies.storage;
    this.malwareScanHook = dependencies.malwareScanHook ?? new NoopMalwareScanHook();
    this.auditSink = dependencies.auditSink;
    this.idGenerator = dependencies.idGenerator ?? defaultIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  listDocuments(): readonly DocumentRecord[] {
    return this.repository.listDocuments();
  }

  getDocumentDetail(documentId: string): DocumentDetail {
    return {
      document: this.repository.getDocumentById(documentId),
      versions: this.repository.listVersionsByDocumentId(documentId),
      accessRules: this.repository.listAccessRulesByDocumentId(documentId),
      activities: this.repository.listActivitiesByDocumentId(documentId),
      publicShareLinks: this.repository.listPublicShareLinksByDocumentId(documentId)
    };
  }

  private async writeAudits(audits: readonly AuditEvent[]): Promise<void> {
    for (const audit of audits) {
      await this.auditSink?.write(audit);
    }
  }

  async uploadDocument(input: UploadDocumentInput): Promise<DocumentRecord> {
    const issues = [
      ...validateDocumentUploadInput(input.file),
      ...validateDocumentVisibility(input.category, input.visibilityFlags),
      ...validateDocumentRetentionFlags(
        input.category,
        dedupeStrings(input.retentionFlags ?? defaultRetentionFlagsForCategory(input.category)) as readonly DocumentRetentionFlag[]
      )
    ];

    if (!input.title.trim()) {
      issues.push("Documents require a title.");
    }

    if (issues.length > 0) {
      throw new DocumentValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const documentId = this.idGenerator("document");
    const versionId = this.idGenerator("document-version");
    const versionNumber = 1;
    const storageKey = buildStorageKey(documentId, versionNumber, input.file.fileName);
    const storedObject = await this.storage.putObject({
      key: storageKey,
      contentType: input.file.contentType,
      byteSize: input.file.byteSize,
      originalFileName: input.file.fileName,
      checksum: input.file.checksum
    });
    const scan = await this.malwareScanHook.scanObject(storedObject);

    if (scan.status === "infected") {
      throw new DocumentValidationError([
        `Malware scan rejected the upload${scan.reason ? `: ${scan.reason}` : "."}`
      ]);
    }

    const previewUrl = await this.storage.buildPreviewUrl({
      key: storageKey
    });
    const downloadUrl = await this.storage.buildDownloadUrl({
      key: storageKey,
      fileName: input.file.fileName
    });

    const version: DocumentVersionRecord = {
      id: versionId,
      documentId,
      versionNumber,
      fileName: input.file.fileName.trim(),
      contentType: input.file.contentType,
      byteSize: input.file.byteSize,
      storageKey,
      checksum: input.file.checksum,
      malwareStatus: "clean",
      previewUrl,
      downloadUrl,
      createdByUserId: input.actorUserId,
      createdAt: nowIso
    };

    const document: DocumentRecord = {
      id: documentId,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      customerAccountId: input.customerAccountId,
      partnerOrgIds: dedupeStrings(input.partnerOrgIds ?? []),
      assignedUserIds: dedupeStrings(input.assignedUserIds ?? []),
      projectId: input.projectId,
      title: input.title.trim(),
      category: input.category,
      expiresAt: input.expiresAt ?? null,
      archiveState: "active",
      retentionFlags: dedupeStrings(
        input.retentionFlags ?? defaultRetentionFlagsForCategory(input.category)
      ) as readonly DocumentRetentionFlag[],
      visibilityFlags: dedupeStrings(input.visibilityFlags) as readonly VisibilityFlag[],
      latestVersionId: version.id,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.repository.createDocument(document);
    this.repository.createVersion(version);
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId,
        eventType: "document_created",
        actorUserId: input.actorUserId,
        summary: `Document ${document.title} uploaded.`,
        visibilityFlags: document.visibilityFlags,
        occurredAt: nowIso
      })
    );
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId,
        eventType: "document_version_uploaded",
        actorUserId: input.actorUserId,
        summary: `Version 1 uploaded for ${document.title}.`,
        visibilityFlags: document.visibilityFlags,
        occurredAt: nowIso
      })
    );

    await this.writeAudits([
      createAuditEvent(nowIso, "document.version_uploaded", "document", document.id, input.actorUserId, {
        versionId: version.id,
        versionNumber: version.versionNumber,
        category: document.category
      })
    ]);

    return document;
  }

  async uploadDocumentVersion(input: DocumentVersionUploadEnvelope): Promise<DocumentVersionRecord> {
    const document = this.repository.getDocumentById(input.documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${input.documentId} was not found.`);
    }

    const issues = validateDocumentUploadInput(input.file);

    if (issues.length > 0) {
      throw new DocumentValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const versionNumber = this.repository.listVersionsByDocumentId(document.id).length + 1;
    const versionId = this.idGenerator("document-version");
    const storageKey = buildStorageKey(document.id, versionNumber, input.file.fileName);
    const storedObject = await this.storage.putObject({
      key: storageKey,
      contentType: input.file.contentType,
      byteSize: input.file.byteSize,
      originalFileName: input.file.fileName,
      checksum: input.file.checksum
    });
    const scan = await this.malwareScanHook.scanObject(storedObject);

    if (scan.status === "infected") {
      throw new DocumentValidationError([
        `Malware scan rejected the upload${scan.reason ? `: ${scan.reason}` : "."}`
      ]);
    }

    const version: DocumentVersionRecord = {
      id: versionId,
      documentId: document.id,
      versionNumber,
      fileName: input.file.fileName.trim(),
      contentType: input.file.contentType,
      byteSize: input.file.byteSize,
      storageKey,
      checksum: input.file.checksum,
      malwareStatus: "clean",
      previewUrl: await this.storage.buildPreviewUrl({ key: storageKey }),
      downloadUrl: await this.storage.buildDownloadUrl({ key: storageKey, fileName: input.file.fileName }),
      createdByUserId: input.actorUserId,
      createdAt: nowIso
    };

    this.repository.createVersion(version);
    this.repository.updateDocument({
      ...document,
      latestVersionId: version.id,
      updatedAt: nowIso
    });
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: "document_version_uploaded",
        actorUserId: input.actorUserId,
        summary: `Version ${version.versionNumber} uploaded for ${document.title}.`,
        visibilityFlags: document.visibilityFlags,
        occurredAt: nowIso
      })
    );

    await this.writeAudits([
      createAuditEvent(nowIso, "document.version_uploaded", "document", document.id, input.actorUserId, {
        versionId: version.id,
        versionNumber: version.versionNumber
      })
    ]);

    return version;
  }

  async replaceDocumentAccessRules(input: ReplaceDocumentAccessRulesInput): Promise<readonly DocumentAccessRuleRecord[]> {
    const document = this.repository.getDocumentById(input.documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${input.documentId} was not found.`);
    }

    const issues = validateDocumentAccessRules(
      input.rules.map((rule) => ({
        ...rule,
        documentId: document.id,
        createdByUserId: input.actorUserId
      }))
    );

    if (issues.length > 0) {
      throw new DocumentValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const rules = input.rules.map((rule) => ({
      id: this.idGenerator("document-access-rule"),
      documentId: document.id,
      principalType: rule.principalType,
      principalId: rule.principalId.trim(),
      actions: dedupeStrings(rule.actions) as readonly typeof rule.actions[number][],
      createdByUserId: input.actorUserId,
      createdAt: nowIso
    }));

    this.repository.replaceAccessRules(document.id, rules);
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: "document_access_rule_changed",
        actorUserId: input.actorUserId,
        summary: "Document access rules replaced.",
        visibilityFlags: document.visibilityFlags,
        occurredAt: nowIso
      })
    );

    await this.writeAudits([
      createAuditEvent(nowIso, "document.access_rule_changed", "document", document.id, input.actorUserId, {
        ruleCount: rules.length
      })
    ]);

    return rules;
  }

  async setDocumentArchiveState(input: SetDocumentArchiveStateInput): Promise<DocumentRecord> {
    const document = this.repository.getDocumentById(input.documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${input.documentId} was not found.`);
    }

    ensureArchiveStateChangeAllowed(document.archiveState, input.archiveState);
    const nowIso = this.now().toISOString();
    const updated = {
      ...document,
      archiveState: input.archiveState,
      updatedAt: nowIso
    };
    this.repository.updateDocument(updated);
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: input.archiveState === "archived" ? "document_archived" : "document_restored",
        actorUserId: input.actorUserId,
        summary: `Document ${input.archiveState === "archived" ? "archived" : "restored"}.`,
        visibilityFlags: document.visibilityFlags,
        occurredAt: nowIso
      })
    );

    await this.writeAudits([
      createAuditEvent(nowIso, "document.archive_state_changed", "document", document.id, input.actorUserId, {
        previousState: document.archiveState,
        nextState: updated.archiveState
      })
    ]);

    return updated;
  }

  async updateDocumentVisibility(input: UpdateDocumentVisibilityInput): Promise<DocumentRecord> {
    const document = this.repository.getDocumentById(input.documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${input.documentId} was not found.`);
    }

    const issues = [
      ...validateDocumentVisibility(document.category, input.visibilityFlags),
      ...validateDocumentRetentionFlags(document.category, document.retentionFlags)
    ];

    if (issues.length > 0) {
      throw new DocumentValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const updated = {
      ...document,
      visibilityFlags: dedupeStrings(input.visibilityFlags) as readonly VisibilityFlag[],
      updatedAt: nowIso
    };

    this.repository.updateDocument(updated);
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: "document_visibility_changed",
        actorUserId: input.actorUserId,
        summary: `Document visibility changed to ${updated.visibilityFlags.join(", ")}.`,
        visibilityFlags: updated.visibilityFlags,
        occurredAt: nowIso
      })
    );

    await this.writeAudits([
      createAuditEvent(nowIso, "document.visibility_changed", "document", document.id, input.actorUserId, {
        previousVisibilityFlags: document.visibilityFlags,
        nextVisibilityFlags: updated.visibilityFlags
      })
    ]);

    return updated;
  }

  async createDocumentPublicShareLink(input: CreateDocumentPublicShareLinkInput): Promise<DocumentPublicShareLinkRecord> {
    const document = this.repository.getDocumentById(input.documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${input.documentId} was not found.`);
    }

    const issues = [...validateDocumentShareScope(input.shareScope)];

    if (!document.visibilityFlags.includes("public_link")) {
      issues.push("Document visibility must include public_link before issuing a public share.");
    }

    if (issues.length > 0) {
      throw new DocumentValidationError(issues);
    }

    const nowIso = this.now().toISOString();
    const link: DocumentPublicShareLinkRecord = {
      id: input.linkId ?? this.idGenerator("document-share-link"),
      documentId: document.id,
      permissionKeys: input.permissionKeys,
      shareScope: input.shareScope,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      expiresAt: input.expiresAt,
      revokedAt: null,
      maxUses: input.maxUses ?? null,
      useCount: 0,
      createdByUserId: input.actorUserId,
      createdAt: nowIso
    };

    this.repository.createPublicShareLink(link);
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: "document_public_link_issued",
        actorUserId: input.actorUserId,
        summary: `Document public link issued with ${input.shareScope} scope.`,
        visibilityFlags: ["internal"],
        occurredAt: nowIso
      })
    );

    return link;
  }

  async revokeDocumentPublicShareLink(input: RevokeDocumentPublicShareLinkInput): Promise<DocumentPublicShareLinkRecord> {
    const link = this.repository.getPublicShareLinkById(input.linkId);

    if (!link) {
      throw new DocumentWorkflowError(`Public link ${input.linkId} was not found.`);
    }

    const document = this.repository.getDocumentById(link.documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${link.documentId} was not found.`);
    }

    const nowIso = this.now().toISOString();
    const updated = {
      ...link,
      revokedAt: nowIso
    };

    this.repository.updatePublicShareLink(updated);
    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: "document_public_link_revoked",
        actorUserId: input.actorUserId,
        summary: "Document public link revoked.",
        visibilityFlags: ["internal"],
        occurredAt: nowIso
      })
    );

    return updated;
  }

  recordDocumentPublicShareAccess(documentId: string): void {
    const document = this.repository.getDocumentById(documentId);

    if (!document) {
      return;
    }

    this.repository.createActivity(
      createActivity(this.idGenerator, {
        documentId: document.id,
        eventType: "document_public_link_accessed",
        summary: "Document public link accessed.",
        visibilityFlags: ["internal"],
        occurredAt: this.now().toISOString()
      })
    );
  }

  buildDownloadResult(documentId: string): DocumentDownloadResult {
    const document = this.repository.getDocumentById(documentId);

    if (!document) {
      throw new DocumentWorkflowError(`Document ${documentId} was not found.`);
    }

    const version = this.repository.getVersionById(document.latestVersionId);

    if (!version) {
      throw new DocumentWorkflowError(`Latest version ${document.latestVersionId} was not found.`);
    }

    if (!version.downloadUrl) {
      throw new DocumentWorkflowError(`Download url for version ${version.id} is unavailable.`);
    }

    return {
      document,
      version,
      downloadUrl: version.downloadUrl
    };
  }
}
