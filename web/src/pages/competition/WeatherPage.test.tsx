import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { competition, heat, session } from '../../test/factories';
import { WeatherPage } from './WeatherPage';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => state.value,
}));

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn() },
}));

const reload = vi.fn();

const day1 = '2030-06-01'; // Saturday
const day2 = '2030-06-02'; // Sunday

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return header ? (
    <div data-testid="page-header">
      <span>{header.title}</span>
      <span>{header.subtitle}</span>
      <span>{header.backTo}</span>
    </div>
  ) : null;
}

function renderWeatherPage() {
  return render(
    <MemoryRouter>
      <CompactPageBarProvider>
        <HeaderProbe />
        <WeatherPage />
      </CompactPageBarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  reload.mockClear();
  vi.mocked(api.get).mockReset();
});

describe('WeatherPage', () => {
  it('renders the top daily weather summary card with high/low temp, rain chance, and hourly rain strip', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/weather/current') {
        return {
          data: {
            current: {
              temperature_2m: 17.4,
              weather_code: 61,
              wind_speed_10m: 19,
              is_day: 1,
            },
          },
        };
      }
      return {
        data: {
          daily: {
            weather_code: [61],
            temperature_2m_max: [20.2],
            temperature_2m_min: [11.4],
            precipitation_probability_max: [75],
            wind_speed_10m_max: [24],
          },
          hourly: {
            time: [
              `${day1}T08:00`,
              `${day1}T09:00`,
              `${day1}T10:00`,
              `${day1}T14:00`,
            ],
            temperature_2m: [12, 14, 16, 19],
            weather_code: [2, 2, 61, 80],
            precipitation_probability: [10, 15, 45, 75],
            precipitation: [0, 0, 0.6, 1.8],
            wind_speed_10m: [10, 12, 18, 24],
            is_day: [1, 1, 1, 1],
          },
        },
      };
    });

    state.value = {
      competition: competition({
        id: 7,
        name: 'Hartpury Area Festival',
        location: 'Hartpury Arena',
        latitude: 51.9,
        longitude: -2.3,
        startDate: day1,
        endDate: day1,
        sessions: [
          session(1, {
            name: 'Morning Heats',
            sectionName: 'Seniors',
            arenaName: 'Main Arena',
            scheduledStart: `${day1}T09:00:00`,
            heats: [heat(11, { sessionId: 1, label: 'Heat 1' })],
          }),
          session(2, {
            name: 'Afternoon Finals',
            sectionName: 'Seniors',
            arenaName: 'Main Arena',
            scheduledStart: `${day1}T14:00:00`,
            heats: [heat(12, { sessionId: 2, label: 'A Final', raceRoundStage: 2 })],
          }),
        ],
      }),
      reload,
      updatedAt: new Date(`${day1}T08:30:00`),
    };

    renderWeatherPage();

    const summary = screen.getByRole('region', { name: 'Day weather summary' });
    await waitFor(() => {
      expect(within(summary).getByText('17°C')).toBeInTheDocument();
    });

    expect(within(summary).getByText('Light rain')).toBeInTheDocument();
    expect(within(summary).getByText(/H: 20°C · L: 11°C/)).toBeInTheDocument();
    expect(within(summary).getByText('75% max rain · 2.4 mm')).toBeInTheDocument();
    expect(within(summary).getByText('Wind up to 24 km/h')).toBeInTheDocument();
    expect(
      within(summary).getByText(/Chance of showers around 14:00 \(75%\) · Rain likely — bring wet-weather kit/),
    ).toBeInTheDocument();

    const strip = within(summary).getByLabelText('Hourly rain and temperature');
    expect(within(strip).getByText('07:00')).toBeInTheDocument();
    expect(within(strip).getByText('10:00')).toBeInTheDocument();
    expect(within(strip).getByText('45% · 0.6mm')).toBeInTheDocument();
    expect(within(strip).getByText('75% · 1.8mm')).toBeInTheDocument();
    expect(within(strip).getByText('19:00')).toBeInTheDocument();

    expect(screen.getByTestId('page-header')).toHaveTextContent('Weather');
    expect(screen.getByTestId('page-header')).toHaveTextContent('Hartpury Area Festival');
    expect(screen.getByTestId('page-header')).toHaveTextContent('/competitions/7');
  });

  it('renders timetable rows with per-hour temperature, rain badge, wind, and session links', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        daily: {
          weather_code: [2],
          temperature_2m_max: [18],
          temperature_2m_min: [10],
          precipitation_probability_max: [55],
          wind_speed_10m_max: [20],
        },
        hourly: {
          time: [`${day1}T09:00`, `${day1}T11:00`, `${day1}T13:00`],
          temperature_2m: [13, 16, 18],
          weather_code: [1, 61, 2],
          precipitation_probability: [10, 55, 15],
          precipitation: [0, 1.1, 0],
          wind_speed_10m: [9, 20, 14],
          is_day: [1, 1, 1],
        },
      },
    });

    state.value = {
      competition: competition({
        id: 4,
        name: 'Spring Games',
        latitude: 52.1,
        longitude: -1.5,
        startDate: day1,
        endDate: day1,
        sessions: [
          session(10, {
            status: 1,
            name: 'Session 1',
            sectionName: 'Seniors',
            arenaName: 'Arena 1',
            scheduledStart: `${day1}T09:00:00`,
            heats: [heat(101, { sessionId: 10, label: 'Heat 1' })],
          }),
          session(20, {
            status: 0,
            name: 'Session 2',
            sectionName: 'Juniors',
            arenaName: 'Arena 2',
            scheduledStart: `${day1}T11:00:00`,
            heats: [heat(202, { sessionId: 20, label: 'Heat 2' })],
          }),
          session(30, {
            status: 0,
            kind: 1,
            isBreak: true,
            name: 'Lunch Break',
            scheduledStart: `${day1}T13:00:00`,
            heats: [],
          }),
        ],
      }),
      reload,
      updatedAt: null,
    };

    renderWeatherPage();

    const timetable = screen.getByRole('region', { name: 'Timetable with weather' });
    await waitFor(() => {
      expect(within(timetable).getByText('55% rain')).toBeInTheDocument();
    });

    const heat1Link = within(timetable).getByRole('link', { name: /09:00.*Heat 1/ });
    expect(heat1Link).toHaveAttribute('href', '/competitions/4/session/10?heat=101');
    expect(heat1Link).toHaveTextContent('On now');
    expect(heat1Link).toHaveTextContent('13°C');
    expect(heat1Link).toHaveTextContent('Dry');
    expect(heat1Link).toHaveTextContent('9 km/h');

    const heat2Link = within(timetable).getByRole('link', { name: /11:00.*Heat 2/ });
    expect(heat2Link).toHaveAttribute('href', '/competitions/4/session/20?heat=202');
    expect(heat2Link).toHaveTextContent('On time');
    expect(heat2Link).toHaveTextContent('16°C');
    expect(heat2Link).toHaveTextContent('55% rain');
    expect(heat2Link).toHaveTextContent('20 km/h');

    expect(within(timetable).getByText('Lunch Break')).toBeInTheDocument();
    expect(within(timetable).getByText('18°C')).toBeInTheDocument();
  });

  it('switches between days on a multi-day competition and updates the forecast and timetable', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string, config) => {
      const dateParam = (config?.params as { date?: string } | undefined)?.date;
      if (url === '/weather/current') {
        return { data: {} };
      }
      if (dateParam === day2) {
        return {
          data: {
            daily: {
              weather_code: [0],
              temperature_2m_max: [23],
              temperature_2m_min: [12],
              precipitation_probability_max: [5],
              wind_speed_10m_max: [11],
            },
            hourly: {
              time: [`${day2}T10:00`],
              temperature_2m: [22],
              weather_code: [0],
              precipitation_probability: [5],
              precipitation: [0],
              wind_speed_10m: [11],
              is_day: [1],
            },
          },
        };
      }
      return {
        data: {
          daily: {
            weather_code: [63],
            temperature_2m_max: [15],
            temperature_2m_min: [9],
            precipitation_probability_max: [40],
            wind_speed_10m_max: [18],
          },
          hourly: {
            time: [`${day1}T09:00`],
            temperature_2m: [14],
            weather_code: [63],
            precipitation_probability: [40],
            precipitation: [0.5],
            wind_speed_10m: [18],
            is_day: [1],
          },
        },
      };
    });

    state.value = {
      competition: competition({
        id: 9,
        name: 'Weekend Championships',
        latitude: 53.0,
        longitude: -1.2,
        startDate: day1,
        endDate: day2,
        sessions: [
          session(1, {
            name: 'Saturday Qualifiers',
            sectionName: 'Seniors',
            scheduledStart: `${day1}T09:00:00`,
            heats: [heat(11, { sessionId: 1, label: 'Saturday Heat 1' })],
          }),
          session(2, {
            name: 'Sunday Finals',
            sectionName: 'Seniors',
            scheduledStart: `${day2}T10:00:00`,
            heats: [heat(22, { sessionId: 2, label: 'Sunday A Final', raceRoundStage: 2 })],
          }),
        ],
      }),
      reload,
      updatedAt: null,
    };

    renderWeatherPage();

    const dayPicker = screen.getByRole('group', { name: 'Choose day' });
    const day1Btn = within(dayPicker).getByRole('button', { name: /Day 1 · Sat/ });
    const day2Btn = within(dayPicker).getByRole('button', { name: /Day 2 · Sun/ });
    expect(day1Btn).toHaveAttribute('aria-pressed', 'true');
    expect(day2Btn).toHaveAttribute('aria-pressed', 'false');

    const summary = screen.getByRole('region', { name: 'Day weather summary' });
    const timetable = screen.getByRole('region', { name: 'Timetable with weather' });

    await waitFor(() => {
      expect(within(summary).getByText(/H: 15°C · L: 9°C/)).toBeInTheDocument();
    });
    expect(within(summary).getByText('Chance of showers around 09:00 (40%)')).toBeInTheDocument();
    expect(within(timetable).getByText('Saturday Heat 1')).toBeInTheDocument();
    expect(within(timetable).queryByText('Sunday A Final')).not.toBeInTheDocument();

    fireEvent.click(day2Btn);

    expect(day2Btn).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(within(summary).getByText(/H: 23°C · L: 12°C/)).toBeInTheDocument();
    });
    expect(within(summary).getByText('Sunny')).toBeInTheDocument();
    expect(within(summary).getByText('Dry all day')).toBeInTheDocument();
    expect(within(timetable).getByText('Sunday A Final')).toBeInTheDocument();
    expect(within(timetable).queryByText('Saturday Heat 1')).not.toBeInTheDocument();
  });

  it('renders a sensible fallback when the competition has no coordinates or no scheduled sessions', () => {
    state.value = {
      competition: competition({
        id: 12,
        name: 'Unmapped Friendly',
        latitude: null,
        longitude: null,
        startDate: day1,
        endDate: day1,
        sessions: [],
      }),
      reload,
      updatedAt: null,
    };

    renderWeatherPage();

    expect(api.get).not.toHaveBeenCalled();
    const summary = screen.getByRole('region', { name: 'Day weather summary' });
    expect(within(summary).getByText('Partly cloudy')).toBeInTheDocument();
    expect(within(summary).getByText('Dry all day')).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled for this day.')).toBeInTheDocument();
  });

  it('handles upstream forecast fallback gracefully', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        error: 'weather_unavailable',
        fallback: {
          weather_code: [3],
          temperature_2m_max: [15],
          temperature_2m_min: [8],
        },
      },
    });

    state.value = {
      competition: competition({
        id: 15,
        name: 'Cloudy Cup',
        latitude: 51.5,
        longitude: -0.1,
        startDate: day1,
        endDate: day1,
        sessions: [
          session(1, {
            name: 'Warm-up Session',
            scheduledStart: `${day1}T08:00:00`,
            heats: [heat(11, { sessionId: 1, label: 'Heat 1' })],
          }),
        ],
      }),
      reload,
      updatedAt: null,
    };

    renderWeatherPage();

    const summary = screen.getByRole('region', { name: 'Day weather summary' });
    await waitFor(() => {
      expect(within(summary).getByText('Overcast')).toBeInTheDocument();
    });
    expect(within(summary).getByText(/H: 15°C · L: 8°C/)).toBeInTheDocument();
  });
});
