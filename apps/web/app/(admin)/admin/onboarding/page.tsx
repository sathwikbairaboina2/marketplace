'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Popconfirm, message } from 'antd';
import { RobotOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import type { StorefrontConfig } from '@marketplace/contracts';
import { useOnboardingSocket } from '../../../../lib/chat/use-onboarding-socket';
import {
  getStorefrontDraft,
  publishStorefront,
  putOnboardingFlag,
} from '../../../../lib/api/storefront';
import { notifyProblem } from '../../../../lib/problem-notify';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { CommentOutlined } from '@ant-design/icons';
import { PreviewPane } from './preview-pane';

export default function OnboardingPage() {
  const { snapshot, connected, error, send } = useOnboardingSocket();
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [publishing, setPublishing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = snapshot?.messages ?? [];
  const drafted = snapshot?.phase === 'drafted';

  // The engine's copy is what the preview renders -- the same document the
  // storefront will read -- so every drafted snapshot triggers a refetch
  // rather than trusting the socket payload.
  useEffect(() => {
    if (!drafted) return;
    getStorefrontDraft()
      .then((res) => setConfig(res.draft))
      .catch(notifyProblem);
  }, [drafted, messages.length]);

  useEffect(() => {
    // Optional-called: jsdom has no scrollIntoView, and the page tests render
    // this effect.
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const submit = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  };

  const publish = async () => {
    setPublishing(true);
    try {
      await publishStorefront();
      message.success('Your store is live');
      router.push('/admin/products');
    } catch (err) {
      notifyProblem(err);
    } finally {
      setPublishing(false);
    }
  };

  const skip = async () => {
    try {
      await putOnboardingFlag({ dismissed: true });
      router.push('/admin/products');
    } catch (err) {
      notifyProblem(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Set up your store"
        subtitle="Tell the assistant about your business; it drafts your theme, About page and banners. Nothing your customers see changes until you publish."
        extra={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button onClick={skip} data-testid="skip-onboarding">
              Skip for now
            </Button>
            <Popconfirm
              title="Publish this store?"
              description="Customers will see the new theme, About page and banners immediately."
              onConfirm={publish}
              okText="Publish"
              disabled={!config}
            >
              <Button
                type="primary"
                loading={publishing}
                disabled={!config}
                data-testid="publish-store"
              >
                Publish store
              </Button>
            </Popconfirm>
          </span>
        }
      />

      <div className="mp-onboarding">
        <section className="mp-chat-panel">
          <div className="mp-chat-log">
            {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}

            {messages.length === 0 ? (
              <EmptyState
                icon={<CommentOutlined />}
                title={connected ? 'Tell me about your business' : 'Connecting…'}
                description="What do you sell or do, what's it called, and who is it for? A sentence or two is plenty."
                action={
                  <Button
                    onClick={() => setDraft('I run a small pottery studio called Kiln & Loom')}
                    disabled={!connected}
                  >
                    Try an example
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
              disabled={!connected}
              maxLength={4000}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={
                drafted ? 'Tell me what to change — warmer, shorter, different headline…' : 'I make…'
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
              disabled={!connected || !draft.trim()}
              onClick={submit}
            >
              Send
            </Button>
          </div>
        </section>

        <section className="mp-onboarding-right">
          <PreviewPane draft={config} />
        </section>
      </div>
    </>
  );
}
