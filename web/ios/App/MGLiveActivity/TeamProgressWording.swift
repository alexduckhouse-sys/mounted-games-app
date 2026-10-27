import Foundation

/// What the card says for each state. Short, plain UK English, readable at a glance in sunlight.
/// No count is ever shown for Unknown or DrawPending: a missing number is better than a wrong one.
extension TeamProgressAttributes.ContentState {
    /// The main line, e.g. "3 heats to go", "You're on", "Waiting for the draw".
    var headline: String {
        switch progressStatus {
        case .unknown: return "Checking…"
        case .drawPending: return "Waiting for the draw"
        case .paused: return "Paused"
        case .finished: return "Finished for today"
        case .withdrawn: return "Withdrawn"
        case .inArena:
            guard let count = shownCount, count > 0 else { return "You're on" }
            return Self.headsUp(count)
        case .upcoming:
            guard let count = shownCount else { return "Coming up" }
            return count == 0 ? "You're next" : Self.headsUp(count)
        }
    }

    /// A short second line under the headline, when there is something useful to add.
    var subline: String? {
        switch progressStatus {
        case .paused:
            guard let count = shownCount else { return "Waiting to restart" }
            return count == 0 ? "You're next when it restarts" : "\(Self.headsUp(count)) when it restarts"
        case .drawPending: return "Lanes appear once the draw is done"
        case .unknown: return "Next heat not confirmed yet"
        default: return nil
        }
    }

    /// Arena, heat and lane, e.g. "Arena 1 · Heat 4 · Lane 3".
    var whereLine: String? {
        let parts = [arenaName, heatLabel, laneIndex.map { "Lane \($0)" }].compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The big number, or nil when a symbol is shown instead.
    var bigNumber: String? {
        switch progressStatus {
        case .upcoming, .paused, .inArena:
            guard let count = shownCount, count > 0 else { return nil }
            return "\(count)"
        default: return nil
        }
    }

    /// Words under the big number ("heats to go" / "heat to go").
    var bigNumberCaption: String { shownCount == 1 ? "heat to go" : "heats to go" }

    /// SF Symbol shown when there is no number.
    var symbol: String {
        switch progressStatus {
        case .unknown: return "ellipsis"
        case .drawPending: return "hourglass"
        case .paused: return "pause.fill"
        case .finished: return "checkmark"
        case .withdrawn: return "xmark"
        case .inArena, .upcoming: return shownCount == nil ? "clock" : "flag.checkered"
        }
    }

    /// A very short label for the compact Dynamic Island when there's no number ("On", "Next").
    var compactWord: String? {
        switch progressStatus {
        case .inArena where (shownCount ?? 0) == 0: return "On"
        case .upcoming where shownCount == 0: return "Next"
        default: return nil
        }
    }

    /// VoiceOver text for the whole card.
    func accessibilitySummary(teamName: String) -> String {
        [teamName, headline, subline, whereLine].compactMap { $0 }.joined(separator: ". ")
    }

    private static func headsUp(_ count: Int) -> String {
        count == 1 ? "1 heat to go" : "\(count) heats to go"
    }
}
