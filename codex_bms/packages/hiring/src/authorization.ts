import { AuthorizationError, authorize, authorizeOrThrow } from "../../auth/src/server/index.ts";
import type {
  ApplicantDocumentRecord,
  ApplicantProfileRecord,
  AuditSink,
  AuthorizationActor,
  AuthorizationDecision,
  InterviewRecord,
  JobApplicationRecord,
  JobOfferRecord,
  JobPostingRecord,
  OnboardingChecklistRecord,
  PermissionKey,
  ResourceRecord,
  VisibilityFlag
} from "../../types/src/index.ts";

const APPLICATION_VIEW_PERMISSION_CANDIDATES: readonly PermissionKey[] = [
  "hiring.application.view.org",
  "hiring.application.view.self"
] as const;

const INTERVIEW_VIEW_PERMISSION_CANDIDATES: readonly PermissionKey[] = [
  "hiring.interview.view.org",
  "hiring.interview.view.assigned",
  "hiring.interview.view.self"
] as const;

const OFFER_VIEW_PERMISSION_CANDIDATES: readonly PermissionKey[] = [
  "hiring.offer.manage.org",
  "hiring.offer.view.self"
] as const;

const ONBOARDING_VIEW_PERMISSION_CANDIDATES: readonly PermissionKey[] = [
  "hiring.application.view.org",
  "hiring.onboarding.view.self"
] as const;

async function authorizeAcrossPermissions(
  actor: AuthorizationActor | undefined,
  record: ResourceRecord,
  permissionKeys: readonly PermissionKey[],
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  let lastDecision: AuthorizationDecision | undefined;

  for (const permissionKey of permissionKeys) {
    const decision = await authorize(
      {
        actor,
        permissionKey,
        record,
        now: new Date()
      },
      auditSink
    );

    if (decision.allowed) {
      return decision;
    }

    lastDecision = decision;
  }

  if (!lastDecision) {
    throw new Error("No permission candidates were provided.");
  }

  return lastDecision;
}

function applicantVisibility() {
  return ["applicant"] as const;
}

function internalVisibility() {
  return ["internal"] as const;
}

export function toJobPostingResourceRecord(jobPosting: JobPostingRecord): ResourceRecord {
  return {
    resourceType: "job_posting",
    resourceId: jobPosting.id,
    orgId: jobPosting.organizationId,
    visibility: jobPosting.status === "published" ? applicantVisibility() : internalVisibility()
  };
}

export function toApplicantProfileResourceRecord(profile: ApplicantProfileRecord): ResourceRecord {
  return {
    resourceType: "applicant_profile",
    resourceId: profile.id,
    ownerUserId: profile.userId ?? null,
    visibility: applicantVisibility()
  };
}

export function toJobApplicationResourceRecord(
  application: JobApplicationRecord,
  profile?: ApplicantProfileRecord
): ResourceRecord {
  return {
    resourceType: "job_application",
    resourceId: application.id,
    orgId: application.organizationId,
    ownerUserId: profile?.userId ?? null,
    visibility: application.visibilityFlags
  };
}

export function toApplicantDocumentResourceRecord(
  document: ApplicantDocumentRecord,
  application: JobApplicationRecord | undefined,
  profile?: ApplicantProfileRecord
): ResourceRecord {
  return {
    resourceType: "applicant_document",
    resourceId: document.id,
    orgId: application?.organizationId,
    ownerUserId: profile?.userId ?? null,
    visibility: document.visibilityFlags
  };
}

export function toInterviewResourceRecord(
  interview: InterviewRecord,
  application: JobApplicationRecord,
  profile?: ApplicantProfileRecord,
  visibility: readonly VisibilityFlag[] = interview.visibilityFlags
): ResourceRecord {
  return {
    resourceType: "interview",
    resourceId: interview.id,
    orgId: application.organizationId,
    ownerUserId: profile?.userId ?? null,
    assignedUserIds: interview.interviewerUserIds,
    visibility
  };
}

export function toJobOfferResourceRecord(
  offer: JobOfferRecord,
  application: JobApplicationRecord,
  profile?: ApplicantProfileRecord
): ResourceRecord {
  return {
    resourceType: "job_offer",
    resourceId: offer.id,
    orgId: application.organizationId,
    ownerUserId: profile?.userId ?? null,
    visibility: offer.visibilityFlags
  };
}

export function toOnboardingChecklistResourceRecord(
  checklist: OnboardingChecklistRecord,
  application: JobApplicationRecord,
  profile?: ApplicantProfileRecord
): ResourceRecord {
  return {
    resourceType: "onboarding_checklist",
    resourceId: checklist.id,
    orgId: application.organizationId,
    ownerUserId: profile?.userId ?? null,
    visibility: checklist.visibilityFlags
  };
}

export async function authorizeJobPostingViewOrThrow(
  actor: AuthorizationActor | undefined,
  jobPosting: JobPostingRecord,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.job_post.view.all",
      record: toJobPostingResourceRecord(jobPosting),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeJobPostingManageOrThrow(
  actor: AuthorizationActor | undefined,
  jobPosting: JobPostingRecord | { id: string; organizationId: string },
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.job_post.manage.org",
      record: {
        resourceType: "job_posting",
        resourceId: jobPosting.id,
        orgId: jobPosting.organizationId,
        visibility: internalVisibility()
      },
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicationView(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeAcrossPermissions(
    actor,
    toJobApplicationResourceRecord(application, profile),
    APPLICATION_VIEW_PERMISSION_CANDIDATES,
    auditSink
  );
}

export async function authorizeApplicationViewOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  const decision = await authorizeApplicationView(actor, application, profile, auditSink);

  if (!decision.allowed) {
    throw new AuthorizationError(decision);
  }

  return decision;
}

export async function authorizeApplicationDraftUpdateOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.application.update.self",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicationSubmitOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.application.submit.self",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicationWithdrawOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.application.withdraw.self",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicationReviewOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.application.review.org",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicationStatusManageOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.application.status.manage.org",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeHiringNoteManageOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.note.manage.org",
      record: {
        resourceType: "hiring_note",
        resourceId: `note:${application.id}`,
        orgId: application.organizationId,
        visibility: internalVisibility()
      },
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicantDocumentUploadOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.document.upload.self",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeApplicantDocumentDeleteOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  const selfDecision = await authorize(
    {
      actor,
      permissionKey: "hiring.document.upload.self",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );

  if (selfDecision.allowed) {
    return selfDecision;
  }

  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.application.review.org",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeInterviewView(
  actor: AuthorizationActor | undefined,
  interview: InterviewRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeAcrossPermissions(
    actor,
    toInterviewResourceRecord(interview, application, profile),
    INTERVIEW_VIEW_PERMISSION_CANDIDATES,
    auditSink
  );
}

export async function authorizeInterviewViewOrThrow(
  actor: AuthorizationActor | undefined,
  interview: InterviewRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  const decision = await authorizeInterviewView(actor, interview, application, profile, auditSink);

  if (!decision.allowed) {
    throw new AuthorizationError(decision);
  }

  return decision;
}

export async function authorizeInterviewScheduleOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.interview.schedule.org",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeInterviewRespondOrThrow(
  actor: AuthorizationActor | undefined,
  interview: InterviewRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.interview.respond.self",
      record: toInterviewResourceRecord(interview, application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeInterviewFeedbackSubmitOrThrow(
  actor: AuthorizationActor | undefined,
  interview: InterviewRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.interview.feedback.submit.assigned",
      record: toInterviewResourceRecord(interview, application, profile, internalVisibility()),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeOfferView(
  actor: AuthorizationActor | undefined,
  offer: JobOfferRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeAcrossPermissions(
    actor,
    toJobOfferResourceRecord(offer, application, profile),
    OFFER_VIEW_PERMISSION_CANDIDATES,
    auditSink
  );
}

export async function authorizeOfferManageOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.offer.manage.org",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}

export async function authorizeOnboardingView(
  actor: AuthorizationActor | undefined,
  checklist: OnboardingChecklistRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeAcrossPermissions(
    actor,
    toOnboardingChecklistResourceRecord(checklist, application, profile),
    ONBOARDING_VIEW_PERMISSION_CANDIDATES,
    auditSink
  );
}

export async function authorizeOnboardingViewOrThrow(
  actor: AuthorizationActor | undefined,
  checklist: OnboardingChecklistRecord,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  const decision = await authorizeOnboardingView(actor, checklist, application, profile, auditSink);

  if (!decision.allowed) {
    throw new AuthorizationError(decision);
  }

  return decision;
}

export async function authorizeApplicantConversionOrThrow(
  actor: AuthorizationActor | undefined,
  application: JobApplicationRecord,
  profile: ApplicantProfileRecord | undefined,
  auditSink?: AuditSink
): Promise<AuthorizationDecision> {
  return authorizeOrThrow(
    {
      actor,
      permissionKey: "hiring.convert.org",
      record: toJobApplicationResourceRecord(application, profile),
      now: new Date()
    },
    auditSink
  );
}
