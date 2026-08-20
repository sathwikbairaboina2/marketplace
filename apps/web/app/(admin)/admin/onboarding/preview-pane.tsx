'use client';

import { useState } from 'react';
import { Button, Empty, Segmented, Upload } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import type { Banner, StorefrontConfig } from '@marketplace/contracts';
import { AboutSections } from '../../../../components/about-sections';
import { StorefrontBanner } from '../../../../components/storefront-banner';
import { uploadProductImage } from '../../../../lib/api/uploads';
import { notifyProblem } from '../../../../lib/problem-notify';
import { resolveTheme } from '../../../../lib/theme/resolve';
import { useTheme } from '../../../../lib/theme/theme-context';

type Tab = 'storefront' | 'about' | 'banners';

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
}: {
  draft: StorefrontConfig | null;
  onChange: (next: StorefrontConfig) => void;
}) {
  const { mode } = useTheme();
  const [tab, setTab] = useState<Tab>('storefront');

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
        ]}
      />

      <div className="mp-onboarding-canvas" style={vars}>
        {tab === 'storefront' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            {hero && <StorefrontBanner banner={hero} />}
            {/* Placeholder product cards so the card treatment -- radius,
                hairline, raised surface, fonts -- previews alongside the hero. */}
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
      </div>
    </div>
  );
}
