'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Input, Table, Tag } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  CommentOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAgentSocket } from '../../../../lib/chat/use-agent-socket';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';

// AgentStateSnapshotSchema's own comment: "What the server emits on every halt.
// The client renders from this and nothing else." This page takes that
// literally -- there is no parallel message list and no locally-guessed phase.
const COMPOSING = new Set(['gathering', 'drafting', 'validating']);

const EXAMPLE = 'Add a colour field to Product';

const PHASE_COLOUR: Record<string, string> = {
  gathering: 'default',
  drafting: 'blue',
  validating: 'blue',
  awaiting_confirmation: 'gold',
  done: 'green',
};

export default function ChatPage() {
  const { snapshot, connected, error, send, confirm, reject } = useAgentSocket();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const phase = snapshot?.phase;
  const canCompose = phase !== undefined && COMPOSING.has(phase);
  const canDecide = phase === 'awaiting_confirmation';
  const messages = snapshot?.messages ?? [];

  // Keep the newest turn in view: a transcript that silently grows off the
  // bottom looks like nothing happened.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, phase]);

  const submit = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  };

  return (
    <>
      <PageHeader
        title="Schema assistant"
        subtitle="Describe a change in plain language. Nothing is applied until you confirm it, and even then a human executes the flow."
        extra={
          phase ? (
            <Tag data-testid="phase" color={PHASE_COLOUR[phase]}>
              {phase}
            </Tag>
          ) : (
            <Tag>{connected ? 'connecting…' : 'offline'}</Tag>
          )
        }
      />

      <div className="mp-chat">
        <section className="mp-chat-panel">
          <div className="mp-chat-log">
            {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}

            {messages.length === 0 ? (
              <EmptyState
                icon={<CommentOutlined />}
                title="No conversation yet"
                description="Ask for a field to be added to Product, Order, Event or Booking. Schema changes are add-only: nothing here can remove a field or change its type."
                action={
                  // Fills the composer rather than sending. A first message is
                  // the hard part of an empty chat, but it is still the
                  // admin's message to send, and an example that dispatches
                  // itself would queue a proposal nobody read.
                  <Button onClick={() => setDraft(EXAMPLE)} disabled={!canCompose}>
                    Try: {EXAMPLE}
                  </Button>
                }
              />
            ) : (
              messages.map((m, i) => (
                <div key={i} className="mp-msg" data-role={m.role}>
                  <span className="mp-msg-avatar" aria-hidden="true">
                    {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                  </span>
                  <div className="mp-msg-bubble" data-testid="message">
                    {m.content}
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <div className="mp-chat-composer">
            <Input.TextArea
              data-testid="composer"
              value={draft}
              disabled={!canCompose}
              maxLength={4000}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={
                canCompose
                  ? 'Add a required text field called colour to Product'
                  : 'The assistant is waiting on your decision'
              }
              onChange={(e) => setDraft(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={!canCompose || !draft.trim()}
              onClick={submit}
            >
              Send
            </Button>
          </div>
        </section>

        <aside className="mp-chat-side">
          <h2>Proposal</h2>

          {snapshot?.targetEntity && (
            <p className="mp-chat-target">
              Target entity <strong>{snapshot.targetEntity}</strong>
            </p>
          )}

          {snapshot?.missingRequirements.length ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Still needed"
              description={snapshot.missingRequirements.join(', ')}
            />
          ) : null}

          {snapshot?.validationErrors.length ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="Validation errors"
              description={snapshot.validationErrors.join(', ')}
            />
          ) : null}

          {/* draftPayload is a BlueprintDiff, and diffs are add-only. */}
          {snapshot?.draftPayload ? (
            <Table
              rowKey="name"
              size="small"
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
          ) : (
            <p className="mp-chat-hint">
              Fields the assistant proposes will appear here for review before anything is queued.
            </p>
          )}

          {canDecide && (
            <div className="mp-chat-decide">
              <Button
                type="primary"
                icon={<CheckOutlined />}
                data-testid="confirm"
                onClick={() => confirm()}
                block
              >
                Confirm
              </Button>
              <Button danger icon={<CloseOutlined />} onClick={() => reject()} block>
                Reject
              </Button>
            </div>
          )}

          {/* Confirming queues a PROPOSE_FLOW message; it does not create a
              Flow. `dispatchedMessageId` and phase `done` are everything the
              socket will ever say, so the flows page takes over and polls. */}
          {phase === 'done' && snapshot?.dispatchedMessageId && (
            <Alert
              style={{ marginTop: 16 }}
              type="success"
              showIcon
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
        </aside>
      </div>
    </>
  );
}
