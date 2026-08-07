'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Col, Input, List, Row, Space, Table, Tag } from 'antd';
import { useAgentSocket } from '../../../lib/chat/use-agent-socket';

// AgentStateSnapshotSchema's own comment: "What the server emits on every halt.
// The client renders from this and nothing else." This page takes that
// literally -- there is no parallel message list and no locally-guessed phase.
const COMPOSING = new Set(['gathering', 'drafting', 'validating']);

export default function ChatPage() {
  const { snapshot, connected, error, send, confirm, reject } = useAgentSocket();
  const [draft, setDraft] = useState('');

  const phase = snapshot?.phase;
  const canCompose = phase !== undefined && COMPOSING.has(phase);
  const canDecide = phase === 'awaiting_confirmation';

  const submit = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  };

  return (
    <Row gutter={24}>
      <Col span={12}>
        <Card title={connected ? 'Conversation' : 'Conversation (connecting…)'}>
          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
          <List
            dataSource={snapshot?.messages ?? []}
            locale={{ emptyText: 'Ask for a change to one of your entities.' }}
            renderItem={(m) => (
              <List.Item>
                <Space align="start">
                  <Tag color={m.role === 'user' ? 'blue' : 'green'}>{m.role}</Tag>
                  <span data-testid="message">{m.content}</span>
                </Space>
              </List.Item>
            )}
          />
          <Space.Compact style={{ width: '100%', marginTop: 16 }}>
            <Input
              data-testid="composer"
              value={draft}
              disabled={!canCompose}
              maxLength={4000}
              placeholder="Add a required text field called colour to Product"
              onChange={(e) => setDraft(e.target.value)}
              onPressEnter={submit}
            />
            <Button type="primary" disabled={!canCompose || !draft.trim()} onClick={submit}>
              Send
            </Button>
          </Space.Compact>
        </Card>
      </Col>

      <Col span={12}>
        <Card
          title="Proposal"
          extra={
            phase ? (
              <Tag data-testid="phase" color={canDecide ? 'orange' : undefined}>
                {phase}
              </Tag>
            ) : null
          }
        >
          {snapshot?.targetEntity && <p>Target entity: {snapshot.targetEntity}</p>}

          {snapshot?.missingRequirements.length ? (
            <Alert
              type="warning"
              style={{ marginBottom: 16 }}
              message="Still needed"
              description={snapshot.missingRequirements.join(', ')}
            />
          ) : null}

          {snapshot?.validationErrors.length ? (
            <Alert
              type="error"
              style={{ marginBottom: 16 }}
              message="Validation errors"
              description={snapshot.validationErrors.join(', ')}
            />
          ) : null}

          {/* draftPayload is a BlueprintDiff, and diffs are add-only. */}
          {snapshot?.draftPayload ? (
            <Table
              rowKey="name"
              pagination={false}
              dataSource={snapshot.draftPayload.addedFields}
              columns={[
                { title: 'Field', dataIndex: 'name' },
                { title: 'Type', dataIndex: 'type' },
                {
                  title: 'Required',
                  dataIndex: 'required',
                  render: (required: boolean) => (required ? 'yes' : 'no'),
                },
              ]}
            />
          ) : null}

          {canDecide && (
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" data-testid="confirm" onClick={() => confirm()}>
                Confirm
              </Button>
              <Button danger onClick={() => reject()}>
                Reject
              </Button>
            </Space>
          )}

          {/* Confirming queues a PROPOSE_FLOW message; it does not create a
              Flow. `dispatchedMessageId` and phase `done` are everything the
              socket will ever say about it, so the flows page takes over from
              here and polls. */}
          {phase === 'done' && snapshot?.dispatchedMessageId && (
            <Alert
              style={{ marginTop: 16 }}
              type="success"
              message="Proposal queued"
              description={
                <>
                  The engine records the flow once its consumer reads the message.{' '}
                  <Link href={`/admin/flows?awaiting=${snapshot.dispatchedMessageId}`}>
                    Watch for it on the flows page
                  </Link>
                  .
                </>
              }
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}
