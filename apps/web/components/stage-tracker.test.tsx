import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Stage } from '@marketplace/contracts';
import { StageTracker } from './stage-tracker';

const stage = (id: string, name: string, over: Partial<Stage> = {}): Stage => ({
  id,
  name,
  cancellable: false,
  messaging: false,
  ...over,
});

describe('StageTracker', () => {
  // A shop that has never configured its stages has exactly one. This is the
  // normal case, not an edge case: every shop starts here.
  it('renders a single-stage shop', () => {
    render(<StageTracker stages={[stage('a', 'Confirmed')]} currentStageId="a" cancelled={false} />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('renders six stages with names at the length bound', () => {
    const long = 'Awaiting the framer to confirm the mount colour choice';
    const stages = Array.from({ length: 6 }, (_, i) => stage(`s${i}`, `${long} ${i}`));
    render(<StageTracker stages={stages} currentStageId="s0" cancelled={false} />);
    expect(screen.getByText(`${long} 5`)).toBeInTheDocument();
  });

  // Nothing here knows what a stage means: twelve stages with names the code has
  // never seen must render exactly as one called "Confirmed" does.
  it('renders twelve stages with names it has never seen', () => {
    const stages = Array.from({ length: 12 }, (_, i) => stage(`s${i}`, `Bespoke phase ${i}`));
    render(<StageTracker stages={stages} currentStageId="s7" cancelled={false} />);
    expect(screen.getAllByTestId('stage-step')).toHaveLength(12);
    expect(screen.getByText('Bespoke phase 11')).toBeInTheDocument();
  });

  it('marks where a cancelled order stopped', () => {
    render(
      <StageTracker
        stages={[stage('a', 'Packing'), stage('b', 'Shipped')]}
        currentStageId="a"
        cancelled
      />,
    );
    expect(screen.getByText(/cancelled at Packing/i)).toBeInTheDocument();
  });

  it('slots extra content under a stage, telling it which state it is in', () => {
    render(
      <StageTracker
        stages={[stage('a', 'One'), stage('b', 'Two')]}
        currentStageId="b"
        cancelled={false}
        renderStageExtra={(s, state) => <p>{`${s.name} is ${state}`}</p>}
      />,
    );
    expect(screen.getByText('One is done')).toBeInTheDocument();
    expect(screen.getByText('Two is current')).toBeInTheDocument();
  });

  // A stage id that is not in the snapshot must not blank the tracker: it should
  // still render every stage the order carries.
  it('survives a current stage it cannot find', () => {
    render(
      <StageTracker
        stages={[stage('a', 'One'), stage('b', 'Two')]}
        currentStageId="missing"
        cancelled={false}
      />,
    );
    expect(screen.getAllByTestId('stage-step')).toHaveLength(2);
  });
});
