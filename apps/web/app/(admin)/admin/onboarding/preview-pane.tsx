'use client';

import { useState } from 'react';
import { Button, Empty, Segmented, Upload } from 'antd';
import { PictureOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { Banner, SetupPlan, StorefrontConfig } from '@marketplace/contracts';
import { AboutSections } from '../../../../components/about-sections';
import { StorefrontBanner } from '../../../../components/storefront-banner';
import { generateBannerArt } from '../../../../lib/api/storefront';
import { uploadProductImage } from '../../../../lib/api/uploads';
import { notifyProblem } from '../../../../lib/problem-notify';
import { resolveTheme } from '../../../../lib/theme/resolve';
import { useTheme } from '../../../../lib/theme/theme-context';
import { SetupTab } from './setup-tab';

type Tab = 'storefront' | 'about' | 'banners' | 'setup';

/**
 * One field of the draft, editable in place. A committed edit hands the whole
 * updated config to onChange -- the page PUTs it as the same whole-document
 * write the agent makes.
 */
function EditableText({
  value,
  onCommit,
  testId,
}: {
  value: string;
  onCommit: (next: string) => void;
  testId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        data-testid={testId}
        title="Click to edit"
        style={{ cursor: 'text', borderBottom: '1px dashed var(--mp-line-strong)' }}
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
        onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = text.trim();
    if (next && next !== value) onCommit(next);
  };

  return (
    <input
      autoFocus
      data-testid={testId ? `${testId}-input` : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      style={{ font: 'inherit', width: '100%' }}
    />
  );
}

/**
 * The right half of the wizard. Renders the draft with the same resolveTheme
 * and the same banner/about components the live storefront uses, scoped to
 * this pane -- what the owner sees here is what a customer would see, minus
 * the real catalogue. Copy is editable in place; edits and uploads go through
 * onChange as full-document updates.
 */
export function PreviewPane({
  draft,
  onChange,
  setupPlan = null,
  imageGen = false,
}: {
  draft: StorefrontConfig | null;
  onChange: (next: StorefrontConfig) => void;
  /** The agent's proposal, when it made one. Absent until the interview completes. */
  setupPlan?: SetupPlan | null;
  /** Whether this deployment can render banner art; hides the button, not just disables it. */
  imageGen?: boolean;
}) {
  const { mode } = useTheme();
  const [tab, setTab] = useState<Tab>('storefront');
  const [generating, setGenerating] = useState<string | null>(null);

  if (!draft) {
    return (
      <div className="mp-onboarding-preview" data-testid="preview-empty">
        <Empty description="Your store preview appears here as we talk" />
      </div>
    );
  }

  const vars = resolveTheme(draft, mode) as React.CSSProperties;
  const hero = draft.banners.find((b) => b.slot === 'hero');

  const patchBanner = (id: string, patch: Partial<Banner>) =>
    onChange({
      ...draft,
      banners: draft.banners.map((b) => (b.id === id ? ({ ...b, ...patch } as Banner) : b)),
    });

  const uploadArt = (banner: Banner) => async (file: File) => {
    try {
      const imageUrl = await uploadProductImage(file);
      patchBanner(banner.id, { art: { kind: 'upload', imageUrl } });
    } catch (err) {
      notifyProblem(err);
    }
    // Handled entirely here; antd's own uploader must not fire.
    return false as const;
  };

  const bannerEditor = (banner: Banner) => (
    <div key={banner.id} className="mp-onboarding-banner-block">
      <StorefrontBanner banner={banner} />
      <div className="mp-onboarding-banner-tools">
        <span className="mp-onboarding-slot">{banner.slot}</span>
        <EditableText
          testId={`edit-${banner.slot}-headline`}
          value={banner.headline}
          onCommit={(headline) => patchBanner(banner.id, { headline })}
        />
        <EditableText
          testId={`edit-${banner.slot}-subline`}
          value={banner.subline}
          onCommit={(subline) => patchBanner(banner.id, { subline })}
        />
        <EditableText
          testId={`edit-${banner.slot}-cta`}
          value={banner.cta.label}
          onCommit={(label) => patchBanner(banner.id, { cta: { ...banner.cta, label } })}
        />
        <Upload
          accept="image/jpeg,image/png,image/webp,image/gif"
          showUploadList={false}
          beforeUpload={uploadArt(banner)}
        >
          <Button size="small" icon={<PictureOutlined />}>
            {banner.art.kind === 'css' ? 'Add photo' : 'Replace photo'}
          </Button>
        </Upload>
        {imageGen && (
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={generating === banner.id}
            data-testid={`generate-${banner.slot}-art`}
            onClick={async () => {
              setGenerating(banner.id);
              try {
                const { imageUrl } = await generateBannerArt(banner.slot);
                patchBanner(banner.id, { art: { kind: 'generated', imageUrl } });
              } catch (err) {
                // The slot keeps whatever art it had; CSS art always works.
                notifyProblem(err);
              } finally {
                setGenerating(null);
              }
            }}
          >
            Generate image
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mp-onboarding-preview" data-testid="preview">
      <Segmented
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        options={[
          { label: 'Storefront', value: 'storefront' },
          { label: 'About', value: 'about' },
          { label: 'Banners', value: 'banners' },
          // Only once there is something to show: an interview that never
          // completed its requirements produces no plan.
          ...(setupPlan ? [{ label: 'Setup', value: 'setup' }] : []),
        ]}
      />

      <div className="mp-onboarding-canvas" style={vars}>
        {tab === 'storefront' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            {hero && <StorefrontBanner banner={hero} />}
            {/* Placeholder product cards so the card treatment -- radius,
                hairline, raised surface, fonts -- previews alongside the hero.
                Suppressed for a shop that sells no products: a yoga studio
                shown three phantom products was the visible half of the bug
                this whole flow exists to fix. */}
            {draft.sellsWhat !== 'bookable' && (
            <div className="mp-onboarding-cards">
              {['One', 'Two', 'Three'].map((name) => (
                <div key={name} className="mp-onboarding-card">
                  <div className="thumb" />
                  <span className="nm" style={{ fontFamily: 'var(--mp-font-heading)' }}>
                    Product {name}
                  </span>
                  <span className="pr">$ —</span>
                </div>
              ))}
            </div>
            )}
          </div>
        )}

        {tab === 'about' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            <div className="mp-onboarding-banner-tools">
              <EditableText
                testId="edit-about-title"
                value={draft.about.title}
                onCommit={(title) => onChange({ ...draft, about: { ...draft.about, title } })}
              />
            </div>
            <AboutSections about={draft.about} />
          </div>
        )}

        {tab === 'banners' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            {draft.banners.map(bannerEditor)}
          </div>
        )}

        {tab === 'setup' && setupPlan && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            <SetupTab plan={setupPlan} />
          </div>
        )}
      </div>
    </div>
  );
}
