import ActivityKit
import Foundation

/// Starts, updates and ends the followed-team Live Activities. Used by the Capacitor plugin and by the
/// DEBUG demo. Updates are driven by the app (no push token): the Push Notifications capability needs a
/// paid Apple account, so server-driven updates wait for the B2 gate.
enum TeamProgressActivities {
    typealias State = TeamProgressAttributes.ContentState

    enum Failure: LocalizedError {
        case notAllowed
        case notFound(String)

        var errorDescription: String? {
            switch self {
            case .notAllowed: return "Live Activities are turned off for MG App in Settings."
            case .notFound(let id): return "No Live Activity with id \(id)."
            }
        }
    }

    /// How long a finished card stays on the lock screen before iOS removes it.
    static let finishedCardLingers: TimeInterval = 15 * 60

    /// The server's freshness bound (`staleAt` is `observedAt` plus 60 seconds); used when none is given.
    static let fallbackStaleAfter: TimeInterval = 60

    static var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    static var running: [Activity<TeamProgressAttributes>] { Activity<TeamProgressAttributes>.activities }

    /// Starts a card for a team, ending any card already running for it so there is never more than one.
    @discardableResult
    static func start(competitionId: Int, teamId: Int, teamName: String, state: State, staleDate: Date) async throws -> Activity<TeamProgressAttributes> {
        guard enabled else { throw Failure.notAllowed }
        for activity in running where activity.attributes.competitionId == competitionId && activity.attributes.teamId == teamId {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        let attributes = TeamProgressAttributes(competitionId: competitionId, teamId: teamId, teamName: teamName, startedAt: Date())
        return try Activity.request(attributes: attributes, content: content(state, staleDate: staleDate), pushType: nil)
    }

    /// Shows a new state. Finished and Withdrawn end the card, leaving that last state up for a while.
    static func update(id: String, state: State, staleDate: Date) async throws {
        guard let activity = find(id) else { throw Failure.notFound(id) }
        if state.endsActivity {
            await activity.end(content(state, staleDate: staleDate), dismissalPolicy: .after(Date().addingTimeInterval(finishedCardLingers)))
        } else {
            await activity.update(content(state, staleDate: staleDate))
        }
    }

    /// Ends a card. With `immediately` it disappears at once (the user stopped following).
    static func end(id: String, state: State?, immediately: Bool) async throws {
        guard let activity = find(id) else { throw Failure.notFound(id) }
        let final = state.map { content($0, staleDate: Date().addingTimeInterval(finishedCardLingers)) }
        await activity.end(final, dismissalPolicy: immediately ? .immediate : .after(Date().addingTimeInterval(finishedCardLingers)))
    }

    static func find(_ id: String) -> Activity<TeamProgressAttributes>? {
        running.first { $0.id == id }
    }

    /// The stale date (the snapshot's `staleAt`) makes iOS mark the card as out of date if it isn't refreshed in time.
    private static func content(_ state: State, staleDate: Date) -> ActivityContent<State> {
        ActivityContent(state: state.sanitised, staleDate: staleDate)
    }
}
