import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WeatherLine } from './WeatherLine';
import { useSetWeatherLine, WeatherLineProvider, type WeatherLineModel } from './WeatherLineContext';

function Setter({ line }: { line: WeatherLineModel | null }) {
  const set = useSetWeatherLine();
  useEffect(() => { set(line); }, [line, set]);
  return null;
}

const mount = (line: WeatherLineModel | null) => render(<WeatherLineProvider><Setter line={line} /><WeatherLine /></WeatherLineProvider>);

describe('WeatherLine', () => {
  it('shows nothing without a provider or without a line', () => {
    const { container } = render(<WeatherLine />);
    expect(container).toBeEmptyDOMElement();
    const { container: empty } = mount(null);
    expect(empty.querySelector('.mg-weather-bar')).toBeNull();
  });

  it('is a button with the action in it when it can be opened', async () => {
    const onOpen = vi.fn();
    mount({ tone: 'warn', icon: 'thunder', text: 'Thunder likely from about 14:00', actionLabel: 'What to do', onOpen });
    const button = screen.getByRole('button', { name: /Thunder likely from about 14:00/ });
    expect(button).toHaveTextContent('What to do');
    expect(screen.getByRole('status')).toContainElement(button);
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is plain text when there is nothing to tap', () => {
    mount({ tone: 'paused', icon: 'rain', text: 'Paused for rain' });
    expect(screen.getByText('Paused for rain')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is green when it is all clear, and goes when the line is cleared', () => {
    const view = render(<WeatherLineProvider><Setter line={{ tone: 'clear', icon: 'sun', text: 'No thunder since 15:15', actionLabel: 'Start again', onOpen: vi.fn() }} /><WeatherLine /></WeatherLineProvider>);
    expect(view.container.querySelector('.mg-weather-bar-clear')).not.toBeNull();
    view.rerender(<WeatherLineProvider><Setter line={null} /><WeatherLine /></WeatherLineProvider>);
    expect(view.container.querySelector('.mg-weather-bar')).toBeNull();
    act(() => {});
  });
});
