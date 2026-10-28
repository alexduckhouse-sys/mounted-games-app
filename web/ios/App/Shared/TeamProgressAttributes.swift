import ActivityKit
import Foundation

// Compiled into both the App and the MGLiveActivity targets (no App Group needed), so the app can start
// and update the activity and the widget extension can draw it. Keep it free of UIKit and Capacitor.

/// TeamProgress status, as numbers on the wire (same values as the API's TeamProgressStatus).
enum TeamProgressStatus: Int, Codable, CaseIterable {
    case unknown = 0
    case upcoming = 1
    case inArena = 2
    case paused = 3
    case drawPending = 4
    case finished = 5
    case withdrawn = 6
}

/// The Live Activity for one followed team. Static fields only: the team's name and ids, never a rider's
/// name or anything private, because the card shows on a locked phone.
struct TeamProgressAttributes: ActivityAttributes {
    /// Mirrors the TeamProgress DTO, less the ids (which never change for an activity), plus the progress
    /// endpoint's `observedAt`. Its `staleAt` becomes the activity's stale date rather than a field here.
    struct ContentState: Codable, Hashable {
        var status: Int
        var sessionId: Int?
        var heatId: Int?
        /// One-based drawn lane.
        var laneIndex: Int?
        /// Unfinished heats ahead in the team's own arena, including one that is running. Nil when not known.
        var heatsUntil: Int?
        var arenaName: String?
        var heatLabel: String?
        /// When the server read the competition, so an out-of-date card can say how old it is.
        var observedAt: Date?
    }

    var competitionId: Int
    var teamId: Int
    var teamName: String
    /// When the activity started. iOS ends an activity after 8 hours, so the app restarts it before then.
    var startedAt: Date
}

extension TeamProgressAttributes.ContentState {
    /// An unrecognised number is treated as Unknown, which never shows a count.
    var progressStatus: TeamProgressStatus { TeamProgressStatus(rawValue: status) ?? .unknown }

    /// The count to show, or nil. Unknown and DrawPending never show one; a negative count is dropped.
    var shownCount: Int? {
        switch progressStatus {
        case .unknown, .drawPending:
            return nil
        default:
            guard let count = heatsUntil, count >= 0 else { return nil }
            return count
        }
    }

    /// Finished and Withdrawn have nothing more to follow, so they end the activity.
    var endsActivity: Bool { progressStatus == .finished || progressStatus == .withdrawn }

    /// The same state with any count it must not show removed.
    var sanitised: Self {
        var copy = self
        copy.heatsUntil = shownCount
        return copy
    }
}
