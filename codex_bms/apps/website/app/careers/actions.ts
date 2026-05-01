"use server";

import { redirect } from "next/navigation";
import {
  getHiringRuntime,
  HiringFormParseError,
  HiringValidationError,
  parsePublicJobApplicationFormData,
  submitPublicJobApplicationServer
} from "../../../../packages/hiring/src/index.ts";

function readScreeningAnswers(formData: FormData): Record<string, string> {
  const answers: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("screeningAnswer:")) {
      continue;
    }

    answers[key.slice("screeningAnswer:".length)] = typeof value === "string" ? value.trim() : "";
  }

  return answers;
}

function buildValidationRedirect(jobPostingId: string, fields: readonly string[]): never {
  redirect(`/careers/${encodeURIComponent(jobPostingId)}/apply?error=validation&fields=${encodeURIComponent(fields.join(","))}`);
}

export async function submitJobApplicationAction(formData: FormData): Promise<never> {
  const runtime = getHiringRuntime();
  const jobPostingId = typeof formData.get("jobPostingId") === "string" ? String(formData.get("jobPostingId")).trim() : "";

  if (!jobPostingId) {
    redirect("/careers?error=missing_job");
  }

  try {
    const parsed = parsePublicJobApplicationFormData(formData);
    const { resumeFile, ...applicationFields } = parsed;

    if (!resumeFile) {
      throw new HiringValidationError([
        {
          field: "resumeUpload",
          message: "Resume upload is required."
        }
      ]);
    }

    const result = await submitPublicJobApplicationServer(
      runtime,
      {
        jobPostingId,
        ...applicationFields,
        resumeFile,
        screeningAnswers: readScreeningAnswers(formData)
      },
      {
        rateLimitKey: `${jobPostingId}:${parsed.email.toLowerCase()}`
      }
    );
    redirect(
      `/careers/${encodeURIComponent(jobPostingId)}/apply/success?applicationId=${encodeURIComponent(result.application.id)}`
    );
  } catch (error) {
    if (error instanceof HiringValidationError) {
      buildValidationRedirect(jobPostingId, error.issues.map((issue) => issue.field));
    }

    if (error instanceof HiringFormParseError) {
      redirect(`/careers/${encodeURIComponent(jobPostingId)}/apply?error=parse`);
    }

    if (error instanceof Error && error.message.toLowerCase().includes("rate limit")) {
      redirect(`/careers/${encodeURIComponent(jobPostingId)}/apply?error=rate_limit`);
    }

    redirect(`/careers/${encodeURIComponent(jobPostingId)}/apply?error=submission`);
  }
}
