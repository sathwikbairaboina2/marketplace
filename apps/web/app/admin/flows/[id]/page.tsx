'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Card, Descriptions, Spin, Table, Tag, message } from 'antd';
import type { FlowResponse } from '@marketplace/contracts';
import { executeFlow, getFlow } from '../../../../lib/api/flows';
import { useSchemas } from '../../../../lib/schemas/schema-cache';
import { notifyProblem } from '../../../../lib/problem-notify';

export default function FlowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { refresh } = useSchemas();
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFlow(id).then(setFlow).catch(notifyProblem);
  }, [id]);

  if (!flow) return <Spin />;

  const execute = async () => {
    setBusy(true);
    try {
      const applied = await executeFlow(flow.id);
      setFlow(applied);
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
          <Tag color={flow.status === 'applied' ? 'green' : 'red'}>{flow.status}</Tag>
        )
      }
    >
      <Descriptions
        column={1}
        items={[
          { key: 'entity', label: 'Target entity', children: flow.targetEntity },
          { key: 'status', label: 'Status', children: flow.status },
          { key: 'proposedBy', label: 'Proposed by', children: flow.proposedBy },
          { key: 'executedBy', label: 'Executed by', children: flow.executedBy ?? '—' },
          { key: 'appliedAt', label: 'Applied at', children: flow.appliedAt ?? '—' },
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
