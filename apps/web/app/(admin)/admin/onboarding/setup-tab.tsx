'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Checkbox, Radio, Space, Tag } from 'antd';
import type { ApplySetupPlanResponse, SellsWhat, SetupPlan } from '@marketplace/contracts';
import { applySetupPlan } from '../../../../lib/api/agents';
import { notifyProblem } from '../../../../lib/problem-notify';

const fieldKey = (entity: string, name: string) => `${entity}.${name}`;

/**
 * The agent's proposal, as a form the owner edits by unticking. Nothing is
 * sent until Apply.
 *
 * No Popconfirm: this writes a private draft and queues proposals a human
 * still has to execute. Publish is the button that changes what customers
 * see, and it is the one that asks.
 */
export function SetupTab({ plan }: { plan: SetupPlan }) {
  const [sellsWhat, setSellsWhat] = useState<SellsWhat>(plan.sellsWhat);
  const [categories, setCategories] = useState<string[]>(plan.categories);
  const [fields, setFields] = useState<string[]>(
    plan.fields.map((f) => fieldKey(f.entity, f.field.name)),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplySetupPlanResponse | null>(null);

  const apply = async () => {
    setBusy(true);
    try {
      setResult(
        await applySetupPlan({
          sellsWhat,
          categories,
          fields: plan.fields
            .filter((f) => fields.includes(fieldKey(f.entity, f.field.name)))
            .map((f) => ({ entity: f.entity, field: f.field })),
        }),
      );
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="mp-setup-result" data-testid="setup-result">
        <p>
          Storefront set to{' '}
          {result.applied.sellsWhat === 'bookable' ? 'bookable events' : result.applied.sellsWhat}
          {result.applied.categories.length > 0 &&
            ` · categories saved: ${result.applied.categories.join(', ')}`}
        </p>

        {result.queued.length > 0 && (
          <p>
            {result.queued.length} field addition{result.queued.length === 1 ? '' : 's'} sent to
            Flows for approval: {result.queued.map((q) => `${q.entity}.${q.fieldName}`).join(', ')}
          </p>
        )}

        {result.failed.length > 0 && (
          <p role="alert">
            Could not queue: {result.failed.map((f) => `${f.entity}.${f.fieldName}`).join(', ')}
          </p>
        )}

        <Link href="/admin/flows">Review in Flows</Link>
      </div>
    );
  }

  return (
    <div className="mp-setup-plan" data-testid="setup-plan">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <h4>What this shop sells</h4>
          <Radio.Group
            value={sellsWhat}
            onChange={(e) => setSellsWhat(e.target.value as SellsWhat)}
          >
            <Radio value="goods">Products</Radio>
            <Radio value="bookable">Bookable events</Radio>
            <Radio value="both">Both</Radio>
          </Radio.Group>
        </div>

        {plan.categories.length > 0 && (
          <div>
            <h4>Categories</h4>
            <Checkbox.Group
              value={categories}
              onChange={(next) => setCategories(next as string[])}
              options={plan.categories.map((c) => ({ label: c, value: c }))}
            />
          </div>
        )}

        {plan.fields.length > 0 && (
          <div>
            <h4>Extra fields</h4>
            <Checkbox.Group
              value={fields}
              onChange={(next) => setFields(next as string[])}
              style={{ width: '100%' }}
            >
              <Space direction="vertical">
                {plan.fields.map((f) => {
                  const key = fieldKey(f.entity, f.field.name);
                  return (
                    <Checkbox key={key} value={key}>
                      {key} <Tag>{f.field.type}</Tag>
                      {f.rationale && <span className="mp-muted"> — {f.rationale}</span>}
                    </Checkbox>
                  );
                })}
              </Space>
            </Checkbox.Group>
          </div>
        )}

        <Button type="primary" loading={busy} onClick={apply} data-testid="apply-setup">
          Apply setup
        </Button>
      </Space>
    </div>
  );
}
