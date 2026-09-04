'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A product's photographs. A product has been able to store twenty since
 * August and every page drew `images[0]`, so a maker who photographed a mug
 * from four angles published one angle.
 *
 * Deliberately nothing at n=1. Every affordance — dots, arrows, a counter — is
 * a promise of a second photograph, and a one-of-a-kind potter often has one;
 * a slideshow of a single image is a worse page than an image. At n=2 the
 * widget is still worth its space on a phone, where the alternative is
 * scrolling past a second full-height picture.
 *
 * A CSS scroll-snap strip rather than a carousel library: the swipe is the
 * browser's, it works without JavaScript having run, and it costs no bundle.
 */
export function ProductGallery({
  images,
  alt,
  children,
}: {
  images: string[];
  alt: string;
  /** The placeholder, for a product with no photograph at all. */
  children?: React.ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  // Which frame is under the eye, read from the scroll position rather than
  // tracked on click: the strip is swipeable, so the scroll is the truth.
  useEffect(() => {
    const el = strip.current;
    if (!el || images.length < 2) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const index = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
        setCurrent(Math.min(Math.max(index, 0), images.length - 1));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [images.length]);

  if (images.length === 0) {
    return <div className="mp-detail-media">{children}</div>;
  }

  if (images.length === 1) {
    return (
      <div className="mp-detail-media">
        {/* Plain img, not next/image: the optimiser needs a remotePatterns
            allow-list that fails confusingly for user-supplied hosts. */}
        <img src={images[0]} alt={alt} />
      </div>
    );
  }

  const go = (index: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="mp-gallery">
      <div className="mp-gallery-strip" ref={strip}>
        {images.map((src, index) => (
          <img
            key={src}
            src={src}
            alt={index === 0 ? alt : `${alt}, photograph ${index + 1}`}
            loading={index === 0 ? undefined : 'lazy'}
          />
        ))}
      </div>

      {/* Over the image, not under it: dots in the flow pushed the price down
          the page on a phone, which is the one thing that must not move. */}
      <div className="mp-gallery-dots" role="tablist" aria-label="Photographs">
        {images.length > 8 ? (
          <span className="mp-gallery-count">
            {current + 1} / {images.length}
          </span>
        ) : (
          images.map((src, index) => (
            <button
              key={src}
              type="button"
              role="tab"
              aria-selected={index === current}
              aria-label={`Photograph ${index + 1}`}
              data-active={index === current || undefined}
              onClick={() => go(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}
