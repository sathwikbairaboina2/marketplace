'use client';

import { useState } from 'react';
import { Alert, Button, Card, Input } from 'antd';
import { CustomerServiceOutlined, SendOutlined } from '@ant-design/icons';
import { askSupport } from '../lib/api/agents';
import { notifyProblem } from '../lib/problem-notify';

/**
 * One question, one grounded answer. The agent reads only the asker's own
 * orders (their token does the scoping), so there is nothing to configure and
 * nothing it can leak. Deliberately not a thread: order-specific conversation
 * belongs on the order's own message thread with the seller.
 */
export function SupportBox() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    try {
      setAnswer((await askSupport(q)).answer);
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className="mp-support-box"
      title={
        <span>
          <CustomerServiceOutlined /> Ask about your orders
        </span>
      }
    >
      <div className="mp-support-composer">
        <Input
          value={question}
          maxLength={1000}
          placeholder="Where is my order?"
          data-testid="support-question"
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
          onPressEnter={() => void ask()}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={busy}
          disabled={busy || !question.trim()}
          onClick={() => void ask()}
          data-testid="support-ask"
        >
          Ask
        </Button>
      </div>
      {answer && (
        <Alert
          type="info"
          showIcon={false}
          message={answer}
          style={{ marginTop: 12 }}
          data-testid="support-answer"
        />
      )}
    </Card>
  );
}
