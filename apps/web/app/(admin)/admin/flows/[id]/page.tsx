'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Card, Descriptions, Table, message } from 'antd';
import type { FlowResponse } from '@marketplace/contracts';
import { executeFlow, getFlow } from '../../../../../lib/api/flows';
import { useSchemas } from '../../../../../lib/schemas/schema-cache';
import { useResource } from '../../../../../lib/use-resource';
import { notifyProblem } from '../../../../../lib/problem-notify';
import { StatusTag } from '../../../../../components/status-tag';
import { ErrorPanel } from '../../../../../components/error-panel';
import { DetailSkeleton } from '../../../../../components/skeletons';
import { formatDateTime } from '../../../../../lib/format';

export default function FlowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { refresh } = useSchemas();
  const [busy, setBusy] = useState(false);
  // Executing returns the applied flow. Holding it here rather than refetching
  // means the status and resulting version update from the response that
  // authorised them, with no second round trip that could disagree.
  const [executed, setExecuted] = useState<FlowResponse | null>(null);

  const { data, error, loading, retry } = useResource<FlowResponse>(() => getFlow(id), [id]);
  const flow = executed ?? data;

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!flow) return null;

  const execute = async () => {
    setBusy(true);
    try {
      const applied = await executeFlow(flow.id);
      setExecuted(applied);
      // Executing raises the registry version. Re-reading the schema cache is
      // what makes the new field show up in every form, filter and detail page
      // without a reload -- it is the whole point of the feature.
      await refresh();
      void message.success(`Applied — registry is now version ${applied.resultingVersion}`);
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`Flow ${flow.id}`}
      extra={
        flow.status === 'proposed' ? (
          <Button type="primary" loading={busy} onClick={() => void execute()}>
            Execute
          </Button>
        ) : (
          <StatusTag status={flow.status} />
        )
      }
    >
      <Descriptions
        column={1}
        items={[
          { key: 'entity', label: 'Target entity', children: flow.targetEntity },
          { key: 'status', label: 'Status', children: <StatusTag status={flow.status} /> },
          { key: 'proposedBy', label: 'Proposed by', children: flow.proposedBy },
          { key: 'executedBy', label: 'Executed by', children: flow.executedBy ?? '—' },
          {
            key: 'appliedAt',
            label: 'Applied at',
            children: flow.appliedAt ? formatDateTime(flow.appliedAt) : '—',
          },
          {
            key: 'version',
            label: 'Resulting version',
            children: flow.resultingVersion ?? '—',
          },
        ]}
      />
      {/* Flows are add-only: `actionType` is the literal 'ADD_FIELDS' and
          BlueprintDiffSchema is .strict() around `addedFields`, so there is no
          removal or type change that could ever need rendering here. */}
      <Table
        style={{ marginTop: 16 }}
        rowKey="name"
        pagination={false}
        title={() => 'Added fields'}
        dataSource={flow.blueprintDiff.addedFields}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Type', dataIndex: 'type' },
          {
            title: 'Required',
            dataIndex: 'required',
            render: (required: boolean) => (required ? 'yes' : 'no'),
          },
          {
            title: 'Default',
            dataIndex: 'default',
            render: (value: unknown) => (value === null ? '—' : String(value)),
          },
        ]}
      />
    </Card>
  );
}
