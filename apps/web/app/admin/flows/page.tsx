'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, Space, Tag } from 'antd';
import type { FlowResponse } from '@marketplace/contracts';
import { listFlows } from '../../../lib/api/flows';
import { CursorTable } from '../../../components/cursor-table';
import { useFlowArrival } from '../../../lib/flows/use-flow-arrival';

function FlowsView() {
  // The chat page links here with ?awaiting=<dispatchedMessageId> after a
  // confirm. That is the only signal the client ever gets that something is on
  // the queue -- the socket says nothing more once the phase reaches `done`.
  const awaiting = useSearchParams().get('awaiting');
  const { waiting, timedOut, reloadToken } = useFlowArrival(Boolean(awaiting));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
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
        reloadToken={reloadToken}
        load={(cursor) => listFlows(25, cursor)}
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
            render: (status: string) => (
              <Tag color={status === 'applied' ? 'green' : status === 'rejected' ? 'red' : 'blue'}>
                {status}
              </Tag>
            ),
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
