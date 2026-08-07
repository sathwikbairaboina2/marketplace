'use client';

import { useRef, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import { IMAGE_CONTENT_TYPES } from '@marketplace/contracts';
import { uploadProductImage } from '../lib/api/uploads';

interface Props {
  value: string[];
  onChange: (urls: string[]) => void;
}

const isSupported = (type: string) => (IMAGE_CONTENT_TYPES as readonly string[]).includes(type);

export function ImageUploader({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (files: File[]) => {
    setError(null);
    const uploaded: string[] = [];

    for (const file of files) {
      // Checked here as well as in the engine. This one is for the person --
      // instant, and costs no round-trip. The engine's check, which reads the
      // file's magic number, is the one that actually enforces anything.
      if (!isSupported(file.type)) {
        setError(`${file.name} is not a supported image (JPEG, PNG, WebP or GIF).`);
        continue;
      }
      try {
        uploaded.push(await uploadProductImage(file));
      } catch (err) {
        setError((err as Error).message);
      }
    }

    // Whatever succeeded is kept: one bad file in a selection of five must not
    // discard the other four.
    if (uploaded.length) onChange([...value, ...uploaded]);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <input
        ref={inputRef}
        data-testid="image-input"
        type="file"
        multiple
        accept={IMAGE_CONTENT_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          setBusy(true);
          void handle(files).finally(() => {
            setBusy(false);
            // Cleared so choosing the same file twice fires `change` again.
            if (inputRef.current) inputRef.current.value = '';
          });
        }}
      />

      <Space>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          Add images
        </Button>
        {busy && <Spin size="small" />}
      </Space>

      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      <Space wrap>
        {value.map((url) => (
          <Space key={url} direction="vertical" align="center">
            {/* Plain img, not next/image: the optimiser needs a remotePatterns
                allow-list that fails confusingly for user-supplied hosts, and
                buys nothing at a fixed 96px. */}
            <img
              src={url}
              alt=""
              width={96}
              height={96}
              style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }}
            />
            <Button size="small" onClick={() => onChange(value.filter((u) => u !== url))}>
              Remove
            </Button>
          </Space>
        ))}
      </Space>
    </Space>
  );
}
