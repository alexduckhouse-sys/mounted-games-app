using MountedGames.Api.Dtos;
namespace MountedGames.Api.Services.Vaccinations;

/// <summary>Calendar-date assessment only. Passport inspection and admission remain separate decisions.</summary>
public static class VaccinationEvaluator
{
    public static DateOnly EligibleOn(DateOnly vaccination, int days, bool clearDays) => vaccination.AddDays(days + (clearDays ? 1 : 0));
    public static DateOnly CalendarDeadline(DateOnly vaccination, int months, int days = 0) => vaccination.AddMonths(months).AddDays(days);
    public static VaccinationEvaluationDto Evaluate(VaccinationSettingsDto settings, IReadOnlyList<DateOnly> dates,
        bool complete, DateOnly? arrival, bool exceptionReview, DateOnly today, DateOnly? lastOtherVaccination = null)
    {
        var policy = VaccinationPolicies.Find(settings.PolicyVersionId);
        var failures = new List<VaccinationFinding>();
        var recommendations = new List<VaccinationFinding>();
        var review = new List<VaccinationFinding>();
        var relevant = new List<DateOnly>();
        var reference = settings.ReferenceDateBasis == "arrival" ? arrival : settings.EventStartOn;
        var source = policy?.SourceUrl;
        bool missing = !complete || dates.Count < 2;
        if (reference is null) { missing = true; review.Add(new("arrival-missing", "Enter the arrival date to check the stand-down and booster dates.")); }
        if (arrival > settings.EventStartOn) review.Add(new("arrival-after-start", "Arrival is after the event starts. Confirm the attendance date with the organiser."));
        if (policy?.Automatic != true) review.Add(new("manual-policy", "The current rules have not been verified. An official must check this policy."));
        else if (reference is { } day && (day < policy.EffectiveFrom || day > policy.EffectiveUntil))
            review.Add(new("edition-date", "This event is outside the selected policy edition. Review the event's policy selection.", source));
        if (missing) review.Add(new("history-missing", "Record the primary course and every later booster, or ask an official to review the missing history.", source));
        if (exceptionReview) review.Add(new("documented-exception", "An official must check the documented exception, including any 2022 vaccine-shortage extension.", source));
        if (dates.Any(d => d > today) || lastOtherVaccination > today) failures.Add(new("future-date", "A recorded vaccination date is in the future."));
        if (dates.Distinct().Count() != dates.Count || dates.Zip(dates.Skip(1)).Any(p => p.First >= p.Second))
            failures.Add(new("date-order", "Enter each vaccination once, from oldest to newest."));
        // Invalid extreme dates must not overflow while showing a historical record.
        if (dates.Any(d => d.Year > 9996) || lastOtherVaccination?.Year > 9996)
            return new("NeedsAttention", reference, settings.PolicyVersionId, [new("date-range", "Check the vaccination year.")], [], review, null);
        if (policy?.Id == VaccinationPolicies.PonyClub2026 && dates.Count >= 2 && reference is { } attendance)
        {
            var historic = dates[1] < new DateOnly(2024, 1, 1);
            if (dates[0] < new DateOnly(2024, 1, 1) && !historic)
                review.Add(new("cohort-review", "The primary course crosses the 2024 rule change. Ask an official to confirm which timing applies.", source));
            var v2days = dates[1].DayNumber - dates[0].DayNumber;
            if (v2days < 21 || v2days > (historic ? 92 : 60))
                failures.Add(new("primary-v2", "The gap between the first two vaccinations does not meet the selected course timing.", source));
            var firstBoosterDue = historic ? CalendarDeadline(dates[1], 7) : dates[1].AddDays(180);
            if (dates.Count == 2)
            {
                relevant.Add(firstBoosterDue);
                if (attendance > firstBoosterDue) failures.Add(new("primary-v3-missing", "The first booster was due before attendance. A restart needs official review.", source, firstBoosterDue));
            }
            else
            {
                if ((!historic && dates[2] < dates[1].AddDays(120)) || dates[2] > firstBoosterDue)
                    failures.Add(new("primary-v3", "The first booster does not meet the selected primary-course timing.", source, firstBoosterDue));
                for (var i = 3; i < dates.Count; i++)
                    if (dates[i] > CalendarDeadline(dates[i - 1], 12))
                        failures.Add(new("booster-gap", "The history includes a gap longer than 12 calendar months. A restart or documented exception needs official review.", source, CalendarDeadline(dates[i - 1], 12)));
            }
            var latest = dates[^1];
            var eligible = EligibleOn(latest, 7, false);
            if (attendance < eligible) { failures.Add(new("stand-down", "The pony is still within the vaccination stand-down period.", source, eligible)); relevant.Add(eligible); }
            if (dates.Count >= 3)
            {
                var annualDue = CalendarDeadline(latest, 12); relevant.Add(annualDue);
                if (attendance > annualDue) failures.Add(new("annual-overdue", "The annual booster is overdue for attendance.", source, annualDue));
            }
            if (arrival is { } arrivalOn)
            {
                var recommendedDue = CalendarDeadline(latest, 6, 21);
                if (arrivalOn > recommendedDue) recommendations.Add(new("six-month-recommendation", "The booster is outside the recommended six months plus 21 days before arrival. This recommendation does not change the mandatory result.", source, recommendedDue));
            }
            else review.Add(new("recommendation-arrival", "Enter arrival to check the six-month-plus-21-day recommendation.", source));
        }
        if (policy?.Id == VaccinationPolicies.PonyClub2026 && reference is { } checkDay)
        {
            var mostRecent = dates.Cast<DateOnly?>().Append(lastOtherVaccination).Max();
            if (mostRecent is { } recent && checkDay < EligibleOn(recent, 7, false) && !failures.Any(x => x.Code == "stand-down"))
            {
                var eligible = EligibleOn(recent, 7, false);
                failures.Add(new("stand-down", "The pony is still within the vaccination stand-down period.", source, eligible)); relevant.Add(eligible);
            }
        }
        foreach (var venue in settings.VenueRules)
        {
            if (reference is not { } day) continue;
            if (venue.ManualReview || day < venue.EffectiveFrom || day > venue.EffectiveUntil)
                review.Add(new("venue-review", $"Ask an official to check {venue.Name} ({venue.Version}).", venue.SourceUrl));
            if (dates.Count == 0) continue;
            var latest = dates[^1];
            if (venue.MaximumMonths is { } months)
            {
                var due = CalendarDeadline(latest, months, venue.AdditionalDays); relevant.Add(due);
                if (day > due) failures.Add(new("venue-booster", $"The latest booster falls outside {venue.Name}'s interval.", venue.SourceUrl, due));
            }
            var eligible = EligibleOn(lastOtherVaccination > latest ? lastOtherVaccination.Value : latest, venue.StandDownDays, venue.ClearDays);
            if (day < eligible) { failures.Add(new("venue-stand-down", $"The pony is within {venue.Name}'s stand-down period.", venue.SourceUrl, eligible)); relevant.Add(eligible); }
        }
        var status = failures.Count > 0 ? "NeedsAttention" : missing ? "MissingHistory" : review.Count > 0 ? "OfficialReviewNeeded" : "DatesMeetRules";
        return new(status, reference, settings.PolicyVersionId, failures, recommendations, review, missing || review.Count > 0 || relevant.Count == 0 ? null : relevant.Min());
    }
}
