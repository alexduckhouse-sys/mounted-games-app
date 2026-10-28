import { CloudLightning, CloudRain, Sun } from 'lucide-react';
import { PAGE_WIDTH_CLASS, usePageWidthValue } from './pageWidthState';
import { useWeatherLine } from './WeatherLineContext';

const ICONS = { thunder: CloudLightning, rain: CloudRain, sun: Sun } as const;

/**
 * The organiser's weather line, under the ticker in the top bar. At most one, only when `WeatherAlert` has something
 * to say; it comes in the way the ticker's lines do (and not at all with reduced motion).
 */
export function WeatherLine() {
  const cap = PAGE_WIDTH_CLASS[usePageWidthValue()];
  const line = useWeatherLine();
  if (!line) return null;
  const Icon = ICONS[line.icon];
  const content = (
    <>
      <Icon aria-hidden="true" strokeWidth={2.5} />
      <span className="mg-weather-text">{line.text}</span>
      {line.actionLabel && <span className="mg-weather-act">{line.actionLabel}</span>}
    </>
  );
  return (
    <div className={`mg-weather-bar${line.tone === 'clear' ? ' mg-weather-bar-clear' : ''}`} role="status">
      <div className={`mx-auto flex w-full ${cap}`}>
        {line.onOpen
          ? <button key={line.tone + line.icon} type="button" className="mg-weather-line ticker-line" onClick={line.onOpen}>{content}</button>
          : <div key={line.tone + line.icon} className="mg-weather-line ticker-line">{content}</div>}
      </div>
    </div>
  );
}
