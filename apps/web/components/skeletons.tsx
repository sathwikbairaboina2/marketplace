'use client';

/**
 * Shape-matched placeholders.
 *
 * Every page previously rendered `<Skeleton paragraph={{ rows: 8 }} />` -- eight
 * grey lines, in front of a page that is a card grid, or a table, or a
 * photograph beside a buy box. A placeholder that does not resemble what is
 * coming tells the reader nothing except that something is happening, which the
 * cursor already told them. These resemble the real layout closely enough that
 * the page does not visibly jump when the data lands.
 *
 * Each block is inert to assistive technology: the page reports its loading
 * state through `aria-busy` on the region, not by having a screen reader
 * enumerate a dozen empty boxes.
 */

function Block({ className }: { className?: string }) {
  return <span className={className ? `mp-sk ${className}` : 'mp-sk'} />;
}

export function GridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="mp-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="mp-sk-card">
          <Block className="mp-sk-media" />
          <Block className="mp-sk-line short" />
          <Block className="mp-sk-line" />
          <Block className="mp-sk-line half" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="mp-sk-table" aria-hidden="true">
      <div className="mp-sk-row mp-sk-head">
        {Array.from({ length: columns }, (_, c) => (
          <Block key={c} className="mp-sk-line short" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="mp-sk-row">
          {Array.from({ length: columns }, (_, c) => (
            <Block key={c} className={c === 0 ? 'mp-sk-line' : 'mp-sk-line half'} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="mp-detail" aria-hidden="true">
      <Block className="mp-sk-detail-media" />
      <div className="mp-sk-detail-body">
        <Block className="mp-sk-line short" />
        <Block className="mp-sk-line title" />
        <Block className="mp-sk-line half" />
        <Block className="mp-sk-line" />
        <Block className="mp-sk-line" />
        <Block className="mp-sk-line half" />
      </div>
    </div>
  );
}
