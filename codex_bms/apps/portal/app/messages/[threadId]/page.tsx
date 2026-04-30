import {
  EmptyState,
  KeyValueSummary,
  PageHeader,
  PlaceholderPanel,
  SectionGrid,
  SimpleList
} from "../../../../../packages/ui/src/react/index.tsx";
import { PortalPageShell } from "../../../lib/page-shell.tsx";
import { getPortalMessageThreadDetail } from "../../../lib/messages-data.ts";

export default async function PortalMessageThreadPage({
  params
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;

  try {
    const detail = await getPortalMessageThreadDetail(threadId);

    return (
      <PortalPageShell activeHref="/messages" title="Messages" subtitle={detail.thread.subject}>
        <PageHeader
          eyebrow="Thread detail"
          title={detail.thread.subject}
          description="Each message inside this thread inherits the same scoped access decision as the thread itself."
          actions={[{ label: "Back to messages", href: "/messages" }]}
          badges={detail.thread.visibilityFlags}
        />
        <SectionGrid>
          <KeyValueSummary
            title="Thread summary"
            description="Thread-level scope fields are what keep cross-account and cross-org access out."
            items={[
              { label: "Status", value: detail.thread.status },
              { label: "Project", value: detail.thread.projectId ?? "General" },
              { label: "Messages", value: String(detail.messages.length) },
              { label: "Last update", value: detail.thread.updatedAt.slice(0, 16).replace("T", " ") }
            ]}
            span="4"
          />
          <SimpleList
            title="Messages"
            description="Replies can only be added through the server-side reply helper after scope authorization."
            items={detail.messages.map((message) => ({
              title: `${message.senderRole} | ${message.senderUserId}`,
              body: message.body,
              meta: message.createdAt.slice(0, 16).replace("T", " ")
            }))}
            span="8"
          />
        </SectionGrid>
      </PortalPageShell>
    );
  } catch {
    return (
      <PortalPageShell activeHref="/messages" title="Messages" subtitle="Not available">
        <PlaceholderPanel
          title="Thread unavailable"
          description="The current portal actor is not authorized to view this thread or the thread does not exist."
          emptyState={{
            title: "Thread unavailable",
            description: "Message access is constrained by customer and partner scope before the thread is exposed.",
            action: { label: "Back to messages", href: "/messages" }
          }}
        >
          <EmptyState
            content={{
              title: "Thread unavailable",
              description: "Message access is constrained by customer and partner scope before the thread is exposed.",
              action: { label: "Back to messages", href: "/messages" }
            }}
          />
        </PlaceholderPanel>
      </PortalPageShell>
    );
  }
}
