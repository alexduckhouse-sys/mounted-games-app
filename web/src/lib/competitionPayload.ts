import type { CompetitionDetail } from '../types';

/** The whole update body: the API clears anything left out, so the fields not being changed are sent as they are. */
export function competitionUpdateBody(competition: CompetitionDetail, patch: Record<string, string | number | boolean | string[] | null>) {
  return {
    name: competition.name,
    icon: competition.icon,
    location: competition.location ?? null,
    description: competition.description ?? null,
    latitude: competition.latitude ?? null,
    longitude: competition.longitude ?? null,
    what3Words: competition.what3Words ?? null,
    appleMapsUrl: competition.appleMapsUrl ?? null,
    streamUrl: competition.streamUrl ?? null,
    organiserName: competition.organiserName ?? null,
    paymentDestination: competition.paymentDestination ?? null,
    termsText: competition.termsText ?? null,
    lorryWhat3Words: competition.lorryWhat3Words ?? null,
    lorryLatitude: competition.lorryLatitude ?? null,
    lorryLongitude: competition.lorryLongitude ?? null,
    lorryDirectionsNote: competition.lorryDirectionsNote ?? null,
    startDate: competition.startDate,
    endDate: competition.endDate ?? null,
    isActive: competition.isActive,
    isArchived: competition.isArchived,
    isIndoor: Boolean(competition.isIndoor),
    ...patch,
  };
}

