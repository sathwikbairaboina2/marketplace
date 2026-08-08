'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, Space } from 'antd';
import type { FlowResponse } from '@marketplace/contracts';
import { listFlows } from '../../../../lib/api/flows';
import { CursorTable } from '../../../../components/cursor-table';
import { EmptyState } from '../../../../components/empty-state';
import { useFlowArrival } from '../../../../lib/flows/use-flow-arrival';
import { StatusTag } from '../../../../components/status-tag';
import { PageHeader } from '../../../../components/page-header';

function FlowsView() {
  // The chat page links here with ?awaiting=<dispatchedMessageId> after a
  // confirm. That is the only signal the client ever gets that something is on
  // the queue -- the socket says nothing more once the phase reaches `done`.
  const awaiting = useSearchParams().get('awaiting');
  const { waiting, timedOut, reloadToken } = useFlowArrival(Boolean(awaiting));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <PageHeader
        title="Flows"
        subtitle="Proposed schema changes. Executing one permanently alters this tenant's data model."
      />
      {waiting && (
        <Alert
          type="info"
          showIcon
          message="Waiting for the proposal to arrive"
          description="The agent queued it. The engine records the flow once its consumer reads the message."
        />
      )}
      {timedOut && (
        <Alert type="warning" showIcon message="Not here yet — refresh to check again" />
      )}
      <CursorTable<FlowResponse>
        rowKey="id"
        caption="Proposed and executed schema changes"
        noun={{ one: 'flow', many: 'flows' }}
        reloadToken={reloadToken}
        load={(cursor) => listFlows(25, cursor)}
        empty={
          <EmptyState
            title="No proposals yet"
            description="Describe a schema change to the assistant and confirm it. The proposal is queued, and the flow appears here once the engine records it."
            action={
              <Link href="/admin/chat">
                <Button type="primary">Open the assistant</Button>
              </Link>
            }
          />
        }
        columns={[
          {
            title: 'Flow',
            dataIndex: 'id',
            render: (id: string) => <Link href={`/admin/flows/${id}`}>{id}</Link>,
          },
          { title: 'Entity', dataIndex: 'targetEntity' },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (status: string) => <StatusTag status={status} />,
          },
          {
            title: 'Adds',
            render: (_, row) => row.blueprintDiff.addedFields.map((f) => f.name).join(', '),
          },
          { title: 'Proposed by', dataIndex: 'proposedBy' },
        ]}
      />
    </Space>
  );
}

export default function FlowsPage() {
  // useSearchParams needs a Suspense boundary, or `next build` fails the whole
  // route with a bail-out-to-CSR error.
  return (
    <Suspense fallback={null}>
      <FlowsView />
    </Suspense>
  );
}
