'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Space, Switch, Tooltip, Typography, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from '@ant-design/icons';
import { MAX_STAGES, type Stage } from '@marketplace/contracts';
import { getPipeline, savePipeline } from '../../../../lib/api/pipeline';
import { ProblemError } from '../../../../lib/api/http';
import { notifyProblem } from '../../../../lib/problem-notify';
import { StageTracker } from '../../../../components/stage-tracker';

/**
 * A stage being edited. `id` is absent for a stage the owner has just added --
 * the engine mints the ULID on save. `key` is local only, so a new row stays
 * identifiable before it has an id.
 */
interface Draft {
  key: string;
  id?: string;
  name: string;
  cancellable: boolean;
  messaging: boolean;
}

const toDraft = (stage: Stage): Draft => ({ ...stage, key: stage.id });

export function StageEditor() {
  const [version, setVersion] = useState(0);
  const [stages, setStages] = useState<Draft[]>([]);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    getPipeline()
      .then((pipeline) => {
        setVersion(pipeline.version);
        setStages(pipeline.stages.map(toDraft));
      })
      .catch(notifyProblem);
  }, []);

  const patch = (key: string, change: Partial<Draft>) =>
    setStages((current) => current.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const move = (index: number, by: number) =>
    setStages((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await savePipeline({
        version,
        stages: stages.map(({ key: _key, ...stage }) => stage),
      });
      setVersion(saved.version);
      setStages(saved.stages.map(toDraft));
      setStale(false);
      void message.success('Order stages published');
    } catch (err) {
      // Bug #9's lesson one layer up: a stale save must not silently clobber the
      // one it never saw. The engine refuses it; this says so and offers the
      // only thing that helps.
      if (err instanceof ProblemError && err.type.includes('pipeline-version-conflict')) {
        setStale(true);
      } else {
        notifyProblem(err);
      }
    } finally {
      setSaving(false);
    }
  };

  const blank = stages.some((stage) => stage.name.trim() === '');
  const duplicate =
    new Set(stages.map((stage) => stage.name.trim().toLowerCase())).size !== stages.length;

  return (
    <Card
      className="mp-form-card"
      title="Order stages"
      extra={
        <Typography.Text type="secondary">
          {stages.length} of {MAX_STAGES}
        </Typography.Text>
      }
    >
      {stale && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Someone else saved the order stages while you were editing."
          description="Reload to see their version, then reapply your changes."
          action={
            <Button size="small" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      )}

      <div className="mp-stage-editor">
        <div>
          {stages.map((stage, index) => (
            <div key={stage.key} data-testid={`stage-row-${index}`} className="mp-stage-row">
              {/* The name gets the full width of the column. Sharing a line with
                  five controls squeezed it to a few characters, which left the
                  owner editing stages they could not read. */}
              <Input
                value={stage.name}
                placeholder="Stage name"
                aria-label={`Stage ${index + 1} name`}
                onChange={(event) => patch(stage.key, { name: event.target.value })}
              />
              <div className="mp-stage-row-controls">
                <Tooltip title="A buyer may cancel while the order is here">
                  <Button
                    size="small"
                    type={stage.cancellable ? 'primary' : 'default'}
                    onClick={() => patch(stage.key, { cancellable: !stage.cancellable })}
                  >
                    Cancellable
                  </Button>
                </Tooltip>
                <Tooltip title="This stage has a message thread">
                  <Button
                    size="small"
                    type={stage.messaging ? 'primary' : 'default'}
                    onClick={() => patch(stage.key, { messaging: !stage.messaging })}
                  >
                    Messages
                  </Button>
                </Tooltip>
                <span className="mp-stage-row-spacer" />
                <Button
                  size="small"
                  icon={<ArrowUpOutlined />}
                  aria-label={`Move ${stage.name || 'stage'} earlier`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  aria-label={`Move ${stage.name || 'stage'} later`}
                  disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={`Remove ${stage.name || 'stage'}`}
                  // One stage is the floor: a shop with none has no lifecycle to
                  // place an order into, and the contract requires at least one.
                  disabled={stages.length === 1}
                  onClick={() => setStages((c) => c.filter((s) => s.key !== stage.key))}
                />
              </div>
            </div>
          ))}

          <Button
            disabled={stages.length >= MAX_STAGES}
            onClick={() => {
              setStages((c) => [
                ...c,
                { key: `new-${added}`, name: '', cancellable: false, messaging: false },
              ]);
              setAdded((n) => n + 1);
            }}
          >
            Add stage
          </Button>
        </div>

        <div>
          <Typography.Text type="secondary">Preview — what a buyer sees</Typography.Text>
          <StageTracker
            // Drafts have no id until they are saved; the local key stands in so
            // the preview can render a stage the engine has never seen.
            stages={stages.map((stage) => ({
              id: stage.id ?? stage.key,
              name: stage.name || 'Untitled stage',
              cancellable: stage.cancellable,
              messaging: stage.messaging,
            }))}
            currentStageId={stages[0]?.id ?? stages[0]?.key ?? ''}
            cancelled={false}
          />
        </div>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        Saving publishes a new version. Orders already placed keep walking the stages they were
        placed under, so a rename or a reorder only changes orders taken from now on.
      </Typography.Paragraph>

      {duplicate && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="Two stages share a name."
          description="A buyer would see two identical steps with no way to tell them apart."
        />
      )}

      <Button type="primary" loading={saving} disabled={blank || duplicate} onClick={save}>
        Publish stages
      </Button>
    </Card>
  );
}
