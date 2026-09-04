import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ImageUploader } from './image-uploader';
import * as api from '../lib/api/uploads';
import { ProblemError } from '../lib/api/http';

const objectUrl = 'http://localhost:4566/marketplace-media/acme/products/01J/x.png';
const pngFile = () => new File([new Uint8Array(8)], 'chair.png', { type: 'image/png' });

const choose = async (files: File[]) => {
  const input = screen.getByTestId('image-input') as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('ImageUploader', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uploads a chosen file and reports the object URL', async () => {
    vi.spyOn(api, 'uploadProductImage').mockResolvedValue(objectUrl);
    const onChange = vi.fn();

    render(<ImageUploader value={[]} onChange={onChange} />);
    await choose([pngFile()]);

    expect(onChange).toHaveBeenCalledWith([objectUrl]);
  });

  it('appends to images already chosen rather than replacing them', async () => {
    vi.spyOn(api, 'uploadProductImage').mockResolvedValue(objectUrl);
    const onChange = vi.fn();

    render(<ImageUploader value={['http://example.test/existing.png']} onChange={onChange} />);
    await choose([pngFile()]);

    expect(onChange).toHaveBeenCalledWith(['http://example.test/existing.png', objectUrl]);
  });

  it('rejects an unsupported type locally, without troubling the engine', async () => {
    const upload = vi.spyOn(api, 'uploadProductImage');
    render(<ImageUploader value={[]} onChange={vi.fn()} />);

    await choose([new File([new Uint8Array(4)], 'doc.pdf', { type: 'application/pdf' })]);

    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByText(/not a supported image/i)).toBeInTheDocument();
  });

  it('shows the engine problem when an upload is refused', async () => {
    vi.spyOn(api, 'uploadProductImage').mockRejectedValue(
      new ProblemError('t', 413, 'Image too large', 'File too large', undefined, []),
    );

    render(<ImageUploader value={[]} onChange={vi.fn()} />);
    await choose([pngFile()]);

    expect(screen.getByText(/Image too large/)).toBeInTheDocument();
  });

  it('keeps the images that did upload when one of several fails', async () => {
    vi.spyOn(api, 'uploadProductImage')
      .mockResolvedValueOnce(objectUrl)
      .mockRejectedValueOnce(new ProblemError('t', 422, 'Not a recognised image', undefined, undefined, []));
    const onChange = vi.fn();

    render(<ImageUploader value={[]} onChange={onChange} />);
    await choose([pngFile(), pngFile()]);

    // One failure must not discard the sibling that succeeded.
    expect(onChange).toHaveBeenCalledWith([objectUrl]);
    expect(screen.getByText(/Not a recognised image/)).toBeInTheDocument();
  });

  it('removes an already-uploaded image', async () => {
    const onChange = vi.fn();
    render(<ImageUploader value={[objectUrl]} onChange={onChange} />);

    await act(async () => {
      screen.getByRole('button', { name: /remove/i }).click();
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('promotes a chosen image to the cover, because the first one is the shop tile', async () => {
    // `images[0]` is the grid tile, the cart line and the cross-sell, and its
    // only author was the order the file picker handed the files over in.
    const onChange = vi.fn();
    render(
      <ImageUploader
        value={['https://media.test/a.jpg', 'https://media.test/b.jpg']}
        onChange={onChange}
      />,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Make cover' }).click();
    });

    expect(onChange).toHaveBeenCalledWith([
      'https://media.test/b.jpg',
      'https://media.test/a.jpg',
    ]);
  });

  it('offers no Make cover on the image that already is one', () => {
    render(<ImageUploader value={['https://media.test/a.jpg']} onChange={vi.fn()} />);

    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make cover' })).not.toBeInTheDocument();
  });
});
