import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyImage } from './LazyImage';
import { liteWrapper } from '../test/lite';

const URL_A = 'https://images.example.test/a.jpg';
const URL_B = 'https://images.example.test/b.jpg';

describe('LazyImage in normal mode', () => {
  it('loads lazily and decodes off the main thread, with a placeholder until it arrives', () => {
    const Normal = liteWrapper('off');
    render(<Normal><LazyImage src={URL_A} alt="Flag set" className="thumb" /></Normal>);
    const img = screen.getByRole('img', { name: 'Flag set' });
    expect(img).toHaveAttribute('src', URL_A);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveClass('thumb', 'mg-lazy-img');
    expect(img).toHaveAttribute('data-state', 'loading');
    fireEvent.load(img);
    expect(img).toHaveAttribute('data-state', 'loaded');
  });

  it('stops showing the placeholder as loading when the picture fails', () => {
    const Normal = liteWrapper('off');
    const { container } = render(<Normal><LazyImage src={URL_A} alt="" /></Normal>);
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(img).toHaveAttribute('data-state', 'failed');
  });

  it('tells the caller when the picture fails', () => {
    const Normal = liteWrapper('off');
    const onFailed = vi.fn();
    const { container } = render(<Normal><LazyImage src={URL_A} alt="" onFailed={onFailed} /></Normal>);
    fireEvent.error(container.querySelector('img')!);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('starts again when the address changes', () => {
    const Normal = liteWrapper('off');
    const { rerender } = render(<Normal><LazyImage src={URL_A} alt="Kit" /></Normal>);
    fireEvent.load(screen.getByRole('img'));
    rerender(<Normal><LazyImage src={URL_B} alt="Kit" /></Normal>);
    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'loading');
  });

  it('works without the provider', () => {
    render(<LazyImage src={URL_A} alt="Kit" />);
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
  });
});

describe('LazyImage in lite mode', () => {
  it('waits for a tap, then loads the picture straight away', () => {
    const Lite = liteWrapper('on');
    render(<Lite><LazyImage src={URL_A} alt="Hickson Feeds" className="banner" /></Lite>);
    expect(screen.queryByRole('img')).toBeNull();
    const card = screen.getByRole('button', { name: 'Load image: Hickson Feeds' });
    expect(card).toHaveClass('banner');
    expect(card).toHaveTextContent('Hickson Feeds');
    expect(card).toHaveTextContent('Tap to load image');
    fireEvent.click(card);
    const img = screen.getByRole('img', { name: 'Hickson Feeds' });
    expect(img).toHaveAttribute('src', URL_A);
    expect(img).toHaveAttribute('loading', 'eager');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows only an icon for a small thumbnail, with no alt text', () => {
    const Lite = liteWrapper('on');
    render(<Lite><LazyImage src={URL_A} alt="" compact /></Lite>);
    const card = screen.getByRole('button', { name: 'Load image' });
    expect(card).toHaveClass('mg-tap-image--compact');
    expect(card.textContent).toBe('');
  });

  it('calls an unnamed picture "Image"', () => {
    const Lite = liteWrapper('on');
    render(<Lite><LazyImage src={URL_A} alt="" /></Lite>);
    expect(screen.getByRole('button', { name: 'Load image' })).toHaveTextContent('Image');
  });

  it('asks again for a different picture', () => {
    const Lite = liteWrapper('on');
    const { rerender } = render(<Lite><LazyImage src={URL_A} alt="Kit" /></Lite>);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('img')).toBeInTheDocument();
    rerender(<Lite><LazyImage src={URL_B} alt="Kit" /></Lite>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Load image: Kit' })).toBeInTheDocument();
  });
});
