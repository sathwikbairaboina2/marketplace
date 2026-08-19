'use client';

import type { ReactNode } from 'react';
import { Steps, Typography } from 'antd';
import type { Stage } from '@marketplace/contracts';

export type StageState = 'done' | 'current' | 'todo';

export interface StageTrackerProps {
  stages: Stage[];
  currentStageId: string;
  cancelled: boolean;
  renderStageExtra?: (stage: Stage, state: StageState) => ReactNode;
}

/**
 * The buyer's view of where their order is.
 *
 * Rendered entirely from the snapshot the order carries. Position is
 * index-in-that-list: there is no name lookup, no assumed stage count and no
 * special case for any particular word, because a shop may call its stages
 * anything and have between one and MAX_STAGES of them. A shop with a single
 * stage called "Confirmed" and a picture framer with six stages nobody has ever
 * seen render through this same code.
 */
export function StageTracker({
  stages,
  currentStageId,
  cancelled,
  renderStageExtra,
}: StageTrackerProps) {
  const found = stages.findIndex((stage) => stage.id === currentStageId);
  // A stage id absent from the snapshot should not blank the tracker: fall back
  // to the first stage so the order still shows the lifecycle it was placed under.
  const currentIndex = found === -1 ? 0 : found;

  return (
    <>
      {cancelled ? (
        // Where it stopped, not merely that it stopped: the order keeps its stage
        // when it is cancelled precisely so this can be said.
        <Typography.Text type="danger" data-testid="stage-cancelled">
          Cancelled at {stages[currentIndex]?.name}
        </Typography.Text>
      ) : null}
      <Steps
        direction="vertical"
        size="small"
        current={currentIndex}
        status={cancelled ? 'error' : 'process'}
        items={stages.map((stage, index) => {
          const state: StageState =
            index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          return {
            title: <span data-testid="stage-step">{stage.name}</span>,
            description: renderStageExtra?.(stage, state),
          };
        })}
      />
    </>
  );
}
