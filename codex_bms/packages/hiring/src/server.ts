import { emitRateLimitBlocked } from "../../security/src/index.ts";
import type {
  ApplicantDocumentRecord,
  ApplicantProfileRecord,
  AuthorizationActor,
  InterviewRecord,
  JobApplicationRecord,
  JobOfferRecord,
  JobPostingRecord,
  OnboardingChecklistRecord
} from "../../types/src/index.ts";
import {
  authorizeApplicantConversionOrThrow,
  authorizeApplicantDocumentDeleteOrThrow,
  authorizeApplicantDocumentUploadOrThrow,
  authorizeApplicationDraftUpdateOrThrow,
  authorizeApplicationReviewOrThrow,
  authorizeApplicationStatusManageOrThrow,
  authorizeApplicationSubmitOrThrow,
  authorizeApplicationView,
  authorizeApplicationViewOrThrow,
  authorizeApplicationWithdrawOrThrow,
  authorizeHiringNoteManageOrThrow,
  authorizeInterviewFeedbackSubmitOrThrow,
  authorizeInterviewRespondOrThrow,
  authorizeInterviewScheduleOrThrow,
  authorizeInterviewView,
  authorizeInterviewViewOrThrow,
  authorizeJobPostingManageOrThrow,
  authorizeJobPostingViewOrThrow,
  authorizeOfferManageOrThrow,
  authorizeOfferView,
  authorizeOnboardingView,
  authorizeOnboardingViewOrThrow
} from "./authorization.ts";
import type { HiringRuntime } from "./runtime.ts";
import type {
  AddHiringInternalNoteInput,
  ConvertApplicantToEmployeeInput,
  CreateJobOfferInput,
  CreateJobPostingInput,
  DeleteApplicantDocumentInput,
  HiringApplicationDetail,
  ScheduleInterviewInput,
  SubmitApplicantDraftApplicationInput,
  SubmitInterviewFeedbackInput,
  SubmitPublicJobApplicationInput,
  UpdateInterviewResponseInput,
  UpdateJobApplicationStatusInput,
  UpdateJobOfferStatusInput,
  UpdateJobPostingInput,
  UploadApplicantDocumentInput,
  UpsertApplicantDraftApplicationInput,
  WithdrawJobApplicationInput
} from "./workflow.ts";

const PUBLIC_APPLICATION_RATE_LIMIT = {
  name: "public-job-application",
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000,
  blockDurationMs: 60 * 60 * 1000
} as const;

function isApplicantActor(actor: AuthorizationActor | undefined): boolean {
  return Boolean(actor?.memberships.some((membership) => membership.role === "applicant"));
}

function isInternalHiringActor(actor: AuthorizationActor | undefined): boolean {
  return Boolean(
    actor?.memberships.some(
      (membership) => membership.role === "owner" || membership.role === "administrator"
    )
  );
}

function requireApplicationDetail(runtime: HiringRuntime, applicationId: string): HiringApplicationDetail {
  const detail = runtime.service.getApplicationDetail(applicationId);

  if (!detail.application) {
    throw new Error(`Job application ${applicationId} was not found.`);
  }

  return detail;
}

function requireApplicationProfile(detail: HiringApplicationDetail): ApplicantProfileRecord {
  if (!detail.applicantProfile) {
    throw new Error(`Applicant profile for application ${detail.application?.id ?? "unknown"} was not found.`);
  }

  return detail.applicantProfile;
}

function requireJobPosting(runtime: HiringRuntime, jobPostingId: string): JobPostingRecord {
  const jobPosting = runtime.repository.getJobPostingById(jobPostingId);

  if (!jobPosting) {
    throw new Error(`Job posting ${jobPostingId} was not found.`);
  }

  return jobPosting;
}

function requireInterview(runtime: HiringRuntime, interviewId: string): InterviewRecord {
  const interview = runtime.repository.getInterviewById(interviewId);

  if (!interview) {
    throw new Error(`Interview ${interviewId} was not found.`);
  }

  return interview;
}

function requireOffer(runtime: HiringRuntime, jobOfferId: string): JobOfferRecord {
  const offer = runtime.repository.getJobOfferById(jobOfferId);

  if (!offer) {
    throw new Error(`Job offer ${jobOfferId} was not found.`);
  }

  return offer;
}

function requireApplicantProfileByUserId(runtime: HiringRuntime, userId: string): ApplicantProfileRecord {
  const profile = runtime.repository.getApplicantProfileByUserId(userId);

  if (!profile) {
    throw new Error(`Applicant profile for user ${userId} was not found.`);
  }

  return profile;
}

function assertRateLimitOrThrow(
  runtime: HiringRuntime,
  input: {
    key: string;
    path: string;
    actorUserId?: string | null;
    ipAddress?: string | null;
  }
): void {
  const now = runtime.now();
  const decision = runtime.security.rateLimiter.check({
    key: input.key,
    rule: PUBLIC_APPLICATION_RATE_LIMIT,
    now,
    metadata: {
      path: input.path
    }
  });

  if (decision.allowed) {
    return;
  }

  void emitRateLimitBlocked({
    auditSink: runtime.auditSink,
    logger: runtime.security.logger,
    monitoringHook: runtime.security.monitoringHook,
    occurredAt: now.toISOString(),
    requestPath: input.path,
    actorUserId: input.actorUserId ?? null,
    ipAddress: input.ipAddress ?? null,
    metadata: {
      ruleName: PUBLIC_APPLICATION_RATE_LIMIT.name,
      retryAfterSeconds: decision.retryAfterSeconds ?? null
    }
  });

  throw new Error("Public application rate limit exceeded.");
}

export async function listPublishedJobPostingsServer(runtime: HiringRuntime): Promise<readonly JobPostingRecord[]> {
  return runtime.service.listPublishedJobPostings();
}

export async function getPublishedJobPostingByIdServer(
  runtime: HiringRuntime,
  jobPostingId: string
): Promise<JobPostingRecord | undefined> {
  const jobPosting = runtime.repository.getJobPostingById(jobPostingId);

  if (!jobPosting || jobPosting.status !== "published") {
    return undefined;
  }

  return jobPosting;
}

export async function listManagedJobPostingsForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly JobPostingRecord[]> {
  const visible: JobPostingRecord[] = [];

  for (const jobPosting of runtime.service.listJobPostings()) {
    try {
      await authorizeJobPostingManageOrThrow(actor, jobPosting, runtime.auditSink);
      visible.push(jobPosting);
    } catch {
      continue;
    }
  }

  return visible;
}

export async function listViewableJobPostingsForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly JobPostingRecord[]> {
  const visible: JobPostingRecord[] = [];

  for (const jobPosting of runtime.service.listJobPostings()) {
    try {
      await authorizeJobPostingViewOrThrow(actor, jobPosting, runtime.auditSink);
      visible.push(jobPosting);
    } catch {
      continue;
    }
  }

  return visible;
}

export async function createJobPostingServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateJobPostingInput
): Promise<JobPostingRecord> {
  await authorizeJobPostingManageOrThrow(
    actor,
    {
      id: "draft-job-posting",
      organizationId: input.organizationId
    },
    runtime.auditSink
  );
  return runtime.service.createJobPosting(input);
}

export async function updateJobPostingServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateJobPostingInput
): Promise<JobPostingRecord> {
  const jobPosting = requireJobPosting(runtime, input.jobPostingId);
  await authorizeJobPostingManageOrThrow(actor, jobPosting, runtime.auditSink);
  return runtime.service.updateJobPosting(input);
}

export async function archiveJobPostingServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: {
    jobPostingId: string;
    actorUserId: string;
  }
): Promise<JobPostingRecord> {
  const jobPosting = requireJobPosting(runtime, input.jobPostingId);
  await authorizeJobPostingManageOrThrow(actor, jobPosting, runtime.auditSink);
  return runtime.service.archiveJobPosting(input);
}

export async function submitPublicJobApplicationServer(
  runtime: HiringRuntime,
  input: SubmitPublicJobApplicationInput,
  context?: {
    rateLimitKey?: string;
    ipAddress?: string;
  }
) {
  const rateLimitKey = context?.rateLimitKey ?? `${input.jobPostingId}:${input.email.trim().toLowerCase()}`;
  assertRateLimitOrThrow(runtime, {
    key: rateLimitKey,
    path: `/careers/${input.jobPostingId}/apply`,
    ipAddress: context?.ipAddress ?? null,
    actorUserId: input.actorUserId ?? null
  });
  return runtime.service.submitPublicJobApplication(input);
}

export async function upsertApplicantDraftApplicationServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: UpsertApplicantDraftApplicationInput
): Promise<JobApplicationRecord> {
  if (input.applicationId) {
    const detail = requireApplicationDetail(runtime, input.applicationId);
    await authorizeApplicationDraftUpdateOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  } else if (!isApplicantActor(actor)) {
    throw new Error("Applicant role required to create a hiring draft.");
  }

  return runtime.service.upsertDraftApplication(input);
}

export async function submitApplicantDraftApplicationServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: SubmitApplicantDraftApplicationInput
): Promise<JobApplicationRecord> {
  const detail = requireApplicationDetail(runtime, input.applicationId);
  await authorizeApplicationSubmitOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.submitDraftApplication(input);
}

export async function uploadApplicantDocumentServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: UploadApplicantDocumentInput
): Promise<ApplicantDocumentRecord> {
  const profile = runtime.repository.getApplicantProfileById(input.applicantProfileId);

  if (!profile) {
    throw new Error(`Applicant profile ${input.applicantProfileId} was not found.`);
  }

  const application = input.jobApplicationId ? runtime.repository.getJobApplicationById(input.jobApplicationId) : undefined;

  if (!application) {
    throw new Error(`Job application ${input.jobApplicationId ?? "unknown"} was not found.`);
  }

  await authorizeApplicantDocumentUploadOrThrow(actor, application, profile, runtime.auditSink);
  return runtime.service.uploadApplicantDocument(input);
}

export async function deleteApplicantDocumentServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: DeleteApplicantDocumentInput
): Promise<void> {
  const document = runtime.repository.getApplicantDocumentById(input.applicantDocumentId);

  if (!document) {
    throw new Error(`Applicant document ${input.applicantDocumentId} was not found.`);
  }

  const application = document.jobApplicationId ? runtime.repository.getJobApplicationById(document.jobApplicationId) : undefined;
  const profile = runtime.repository.getApplicantProfileById(document.applicantProfileId);

  if (!application) {
    throw new Error(`Job application ${document.jobApplicationId ?? "unknown"} was not found.`);
  }

  await authorizeApplicantDocumentDeleteOrThrow(actor, application, profile, runtime.auditSink);
  return runtime.service.deleteApplicantDocument(input);
}

export async function listVisibleApplicationsForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly JobApplicationRecord[]> {
  const visible: JobApplicationRecord[] = [];

  for (const application of runtime.service.listApplications()) {
    const profile = runtime.repository.getApplicantProfileById(application.applicantProfileId);
    const decision = await authorizeApplicationView(actor, application, profile, runtime.auditSink);

    if (decision.allowed) {
      visible.push(application);
    }
  }

  return visible;
}

export async function getApplicationDetailForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  applicationId: string
): Promise<HiringApplicationDetail | undefined> {
  const detail = runtime.service.getApplicationDetail(applicationId);

  if (!detail.application) {
    return undefined;
  }

  await authorizeApplicationViewOrThrow(actor, detail.application, detail.applicantProfile, runtime.auditSink);

  if (isInternalHiringActor(actor)) {
    return detail;
  }

  return {
    ...detail,
    internalNotes: [],
    interviewFeedback: [],
    offers: detail.offers.filter((offer) => offer.status !== "draft")
  };
}

export async function addHiringInternalNoteServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: AddHiringInternalNoteInput
) {
  const detail = requireApplicationDetail(runtime, input.jobApplicationId);
  await authorizeApplicationReviewOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  await authorizeHiringNoteManageOrThrow(actor, detail.application!, runtime.auditSink);
  return runtime.service.addInternalNote(input);
}

export async function updateApplicationStatusServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateJobApplicationStatusInput
): Promise<JobApplicationRecord> {
  const detail = requireApplicationDetail(runtime, input.jobApplicationId);
  await authorizeApplicationStatusManageOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.updateApplicationStatus(input);
}

export async function withdrawApplicationServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: WithdrawJobApplicationInput
): Promise<JobApplicationRecord> {
  const detail = requireApplicationDetail(runtime, input.jobApplicationId);
  await authorizeApplicationWithdrawOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.withdrawApplication(input);
}

export async function listVisibleInterviewsForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly InterviewRecord[]> {
  const visible: InterviewRecord[] = [];

  for (const application of runtime.service.listApplications()) {
    const profile = runtime.repository.getApplicantProfileById(application.applicantProfileId);

    for (const interview of runtime.repository.listInterviewsByApplicationId(application.id)) {
      const decision = await authorizeInterviewView(actor, interview, application, profile, runtime.auditSink);

      if (decision.allowed) {
        visible.push(interview);
      }
    }
  }

  return visible;
}

export async function scheduleInterviewServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: ScheduleInterviewInput
): Promise<InterviewRecord> {
  const detail = requireApplicationDetail(runtime, input.jobApplicationId);
  await authorizeInterviewScheduleOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.scheduleInterview(input);
}

export async function getInterviewDetailForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  interviewId: string
): Promise<{
  interview: InterviewRecord;
  application: JobApplicationRecord;
  applicantProfile?: ApplicantProfileRecord;
}> {
  const interview = requireInterview(runtime, interviewId);
  const detail = requireApplicationDetail(runtime, interview.jobApplicationId);
  await authorizeInterviewViewOrThrow(actor, interview, detail.application!, detail.applicantProfile, runtime.auditSink);
  return {
    interview,
    application: detail.application!,
    applicantProfile: detail.applicantProfile
  };
}

export async function respondToInterviewServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateInterviewResponseInput
): Promise<InterviewRecord> {
  const interview = requireInterview(runtime, input.interviewId);
  const detail = requireApplicationDetail(runtime, interview.jobApplicationId);
  await authorizeInterviewRespondOrThrow(actor, interview, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.respondToInterview(input);
}

export async function submitInterviewFeedbackServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: SubmitInterviewFeedbackInput
) {
  const interview = requireInterview(runtime, input.interviewId);
  const detail = requireApplicationDetail(runtime, interview.jobApplicationId);
  await authorizeInterviewFeedbackSubmitOrThrow(actor, interview, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.submitInterviewFeedback(input);
}

export async function listVisibleOffersForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly JobOfferRecord[]> {
  const visible: JobOfferRecord[] = [];

  for (const application of runtime.service.listApplications()) {
    const profile = runtime.repository.getApplicantProfileById(application.applicantProfileId);

    for (const offer of runtime.repository.listJobOffersByApplicationId(application.id)) {
      const decision = await authorizeOfferView(actor, offer, application, profile, runtime.auditSink);

      if (decision.allowed && (!isApplicantActor(actor) || offer.status !== "draft")) {
        visible.push(offer);
      }
    }
  }

  return visible;
}

export async function createJobOfferServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: CreateJobOfferInput
): Promise<JobOfferRecord> {
  const detail = requireApplicationDetail(runtime, input.jobApplicationId);
  await authorizeOfferManageOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.createJobOffer(input);
}

export async function updateJobOfferStatusServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: UpdateJobOfferStatusInput
): Promise<JobOfferRecord> {
  const offer = requireOffer(runtime, input.jobOfferId);
  const detail = requireApplicationDetail(runtime, offer.jobApplicationId);
  await authorizeOfferManageOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.updateJobOfferStatus(input);
}

export async function getOnboardingChecklistForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  applicationId: string
): Promise<{
  checklist: OnboardingChecklistRecord;
  tasks: HiringApplicationDetail["onboardingTasks"];
} | undefined> {
  const detail = requireApplicationDetail(runtime, applicationId);

  if (!detail.onboardingChecklist) {
    return undefined;
  }

  await authorizeOnboardingViewOrThrow(
    actor,
    detail.onboardingChecklist,
    detail.application!,
    detail.applicantProfile,
    runtime.auditSink
  );

  return {
    checklist: detail.onboardingChecklist,
    tasks: detail.onboardingTasks
  };
}

export async function listVisibleOnboardingChecklistsForActor(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined
): Promise<readonly OnboardingChecklistRecord[]> {
  const visible: OnboardingChecklistRecord[] = [];

  for (const application of runtime.service.listApplications()) {
    const detail = runtime.service.getApplicationDetail(application.id);

    if (!detail.onboardingChecklist) {
      continue;
    }

    const decision = await authorizeOnboardingView(
      actor,
      detail.onboardingChecklist,
      application,
      detail.applicantProfile,
      runtime.auditSink
    );

    if (decision.allowed) {
      visible.push(detail.onboardingChecklist);
    }
  }

  return visible;
}

export async function convertApplicantToEmployeeServer(
  runtime: HiringRuntime,
  actor: AuthorizationActor | undefined,
  input: ConvertApplicantToEmployeeInput
) {
  const detail = requireApplicationDetail(runtime, input.jobApplicationId);
  await authorizeApplicantConversionOrThrow(actor, detail.application!, detail.applicantProfile, runtime.auditSink);
  return runtime.service.convertApplicantToEmployee(input);
}
