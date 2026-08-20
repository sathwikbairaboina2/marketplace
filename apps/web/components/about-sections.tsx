'use client';

import type { AboutPage } from '@marketplace/contracts';

/**
 * The tenant's story, rendered from the published config. Shared between the
 * storefront's /about route and the wizard preview.
 */
export function AboutSections({ about }: { about: AboutPage }) {
  return (
    <article className="mp-about">
      <h1 style={{ fontFamily: 'var(--mp-font-heading)' }}>{about.title}</h1>
      {about.sections.map((section) => (
        <section key={section.heading}>
          <h2 style={{ fontFamily: 'var(--mp-font-heading)' }}>{section.heading}</h2>
          <p style={{ fontFamily: 'var(--mp-font-body)' }}>{section.body}</p>
        </section>
      ))}
    </article>
  );
}
