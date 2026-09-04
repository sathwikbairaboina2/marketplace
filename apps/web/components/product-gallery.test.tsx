import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductGallery } from './product-gallery';

describe('ProductGallery', () => {
  it('renders no gallery furniture for a single photograph', () => {
    // The load-bearing decision. A one-of-a-kind potter often has one picture,
    // and dots, arrows or a counter over it are all promises of a second one.
    render(<ProductGallery images={['https://media.test/a.jpg']} alt="Coupe Mug" />);

    expect(screen.getByRole('img', { name: 'Coupe Mug' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('falls back to the placeholder when there is no photograph at all', () => {
    render(
      <ProductGallery images={[]} alt="Coupe Mug">
        <span>CM</span>
      </ProductGallery>,
    );

    expect(screen.getByText('CM')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows one dot per photograph from two upwards, the first selected', () => {
    render(
      <ProductGallery
        images={['https://media.test/a.jpg', 'https://media.test/b.jpg']}
        alt="Coupe Mug"
      />,
    );

    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveAttribute('aria-selected', 'true');
    expect(dots[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('names the photographs after the first, so they are distinguishable', () => {
    render(
      <ProductGallery
        images={['https://media.test/a.jpg', 'https://media.test/b.jpg']}
        alt="Coupe Mug"
      />,
    );

    expect(screen.getByRole('img', { name: 'Coupe Mug' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Coupe Mug, photograph 2' })).toBeInTheDocument();
  });

  it('counts rather than drawing a row of dots once there are many', () => {
    const images = Array.from({ length: 12 }, (_, i) => `https://media.test/${i}.jpg`);
    render(<ProductGallery images={images} alt="Coupe Mug" />);

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 12')).toBeInTheDocument();
  });

  it('lazy-loads everything but the first frame', () => {
    render(
      <ProductGallery
        images={['https://media.test/a.jpg', 'https://media.test/b.jpg']}
        alt="Coupe Mug"
      />,
    );

    expect(screen.getByRole('img', { name: 'Coupe Mug' })).not.toHaveAttribute('loading');
    expect(screen.getByRole('img', { name: 'Coupe Mug, photograph 2' })).toHaveAttribute(
      'loading',
      'lazy',
    );
  });
});
