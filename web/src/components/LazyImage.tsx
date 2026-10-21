import { useState } from 'react';
import { ImageDown } from 'lucide-react';
import { useLiteMode } from '../lite/LiteModeContext';

/**
 * A picture from a web address. Normally it loads as it scrolls into view, with a soft block of colour
 * until it arrives. In lite mode it waits for a tap. Use `compact` for small thumbnails, where the
 * tap target shows only an icon. Give `className` the size and shape, as for an `<img>`.
 */
export function LazyImage({ src, alt, className = '', compact = false }: { src: string; alt: string; className?: string; compact?: boolean }) {
  const { lite } = useLiteMode();
  const [asked, setAsked] = useState<string | null>(null);
  const [state, setState] = useState<{ src: string; value: 'loaded' | 'failed' } | null>(null);
  const status = state?.src === src ? state.value : 'loading';

  if (lite && asked !== src) {
    return (
      <button type="button" className={`mg-tap-image ${compact ? 'mg-tap-image--compact' : ''} ${className}`} onClick={() => setAsked(src)} aria-label={alt ? `Load image: ${alt}` : 'Load image'}>
        <ImageDown aria-hidden="true" />
        {!compact && <span className="mg-tap-image-text"><b>{alt || 'Image'}</b><small>Tap to load image</small></span>}
      </button>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={lite ? 'eager' : 'lazy'}
      decoding="async"
      data-state={status}
      className={`mg-lazy-img ${className}`}
      onLoad={() => setState({ src, value: 'loaded' })}
      onError={() => setState({ src, value: 'failed' })}
    />
  );
}
