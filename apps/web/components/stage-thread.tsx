'use client';

import { useState } from 'react';
import { Button, Input, List, Typography } from 'antd';
import type { MessageResponse } from '@marketplace/contracts';
import { postMessage } from '../lib/api/messages';
import { notifyProblem } from '../lib/problem-notify';
import { formatDateTime } from '../lib/format';

export interface StageThreadProps {
  orderId: string;
  messages: MessageResponse[];
  /** The stage is the order's current one, and the order is still confirmed. */
  open: boolean;
  onPosted: (message: MessageResponse) => void;
}

/**
 * One stage's conversation. Open on the stage the order is in, read-only
 * everywhere else -- a stage the order has left is history.
 */
export function StageThread({ orderId, messages, open, onPosted }: StageThreadProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const posted = await postMessage(orderId, draft.trim());
      // Cleared only once the post is known to have landed: emptying the box on
      // a failed send would lose what the buyer wrote.
      setDraft('');
      onPosted(posted);
    } catch (err) {
      // Reported, not rethrown. This runs from an onClick handler, so a rethrow
      // becomes an unhandled rejection: the buyer's message silently fails to
      // send and nothing on the page says so. The stage may also have closed
      // under them, which notifyProblem shows as the engine's own problem
      // document rather than a generic failure.
      notifyProblem(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <List
        size="small"
        dataSource={messages}
        locale={{ emptyText: 'No messages' }}
        renderItem={(message) => (
          <List.Item key={message.id}>
            <List.Item.Meta
              title={
                <Typography.Text type="secondary">
                  {message.authorRole === 'buyer' ? 'Buyer' : 'Seller'} ·{' '}
                  {formatDateTime(message.createdAt)}
                </Typography.Text>
              }
              description={message.body}
            />
          </List.Item>
        )}
      />
      {open ? (
        <>
          <Input.TextArea
            rows={2}
            value={draft}
            placeholder="Write a message…"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="primary"
            size="small"
            loading={sending}
            disabled={draft.trim().length === 0}
            onClick={send}
            style={{ marginTop: 8 }}
          >
            Send
          </Button>
        </>
      ) : null}
    </>
  );
}
