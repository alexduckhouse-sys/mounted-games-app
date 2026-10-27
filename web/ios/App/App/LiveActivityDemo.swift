#if DEBUG
import ActivityKit
import Foundation
import UIKit

/// DEBUG-only demo, so the Live Activity can be seen in the Simulator without the web page or a server.
/// Launch arguments (Xcode scheme, or `xcrun simctl launch <device> <bundle id> -MGDemoLiveActivity YES`):
///
///   -MGDemoLiveActivity YES   start a made-up team's card and step it through the states below
///   -MGDemoStepSeconds 8      seconds between steps (default 8)
///   -MGDemoStep 4             show only that step (0-based) and stay there, for screenshots
///   -MGDemoStaleSeconds 60    how long each state counts as current (default 60, like the server)
///
/// The values match `src/native/fixtures.ts`. No real team or rider is involved.
enum LiveActivityDemo {
    typealias State = TeamProgressAttributes.ContentState

    static let teamName = "Hollybrook A"

    static let steps: [State] = [
        State(status: TeamProgressStatus.unknown.rawValue, sessionId: 1, heatId: nil, laneIndex: nil, heatsUntil: nil, arenaName: "Arena 1", heatLabel: nil, observedAt: Date()),
        upcoming(3),
        upcoming(2),
        upcoming(1),
        State(status: TeamProgressStatus.inArena.rawValue, sessionId: 1, heatId: 12, laneIndex: 3, heatsUntil: 0, arenaName: "Arena 1", heatLabel: "Heat 4", observedAt: Date()),
        State(status: TeamProgressStatus.paused.rawValue, sessionId: 1, heatId: 12, laneIndex: 3, heatsUntil: 0, arenaName: "Arena 1", heatLabel: "Heat 4", observedAt: Date()),
        State(status: TeamProgressStatus.drawPending.rawValue, sessionId: 1, heatId: nil, laneIndex: nil, heatsUntil: nil, arenaName: "Arena 1", heatLabel: "A Final", observedAt: Date()),
        State(status: TeamProgressStatus.finished.rawValue, sessionId: 1, heatId: nil, laneIndex: nil, heatsUntil: nil, arenaName: "Arena 1", heatLabel: nil, observedAt: Date()),
    ]

    private static func upcoming(_ count: Int) -> State {
        State(status: TeamProgressStatus.upcoming.rawValue, sessionId: 1, heatId: 12, laneIndex: 3, heatsUntil: count, arenaName: "Arena 1", heatLabel: "Heat 4", observedAt: Date())
    }

    /// A step as if the server had just read it.
    private static func stamped(_ state: State) -> State {
        var copy = state
        copy.observedAt = Date()
        return copy
    }

    private static var timer: Timer?
    private static var stepIndex = 0
    private static var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    /// Starts the demo if the launch arguments ask for it.
    static func startIfRequested() {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: "MGDemoLiveActivity") else { return }
        let stepSeconds = defaults.double(forKey: "MGDemoStepSeconds") > 0 ? defaults.double(forKey: "MGDemoStepSeconds") : 8
        let staleAfter = defaults.double(forKey: "MGDemoStaleSeconds") > 0 ? defaults.double(forKey: "MGDemoStaleSeconds") : TeamProgressActivities.fallbackStaleAfter
        let fixedStep = defaults.object(forKey: "MGDemoStep") != nil ? min(max(defaults.integer(forKey: "MGDemoStep"), 0), steps.count - 1) : nil

        Task { @MainActor in
            do {
                let first = fixedStep ?? 0
                let activity = try await TeamProgressActivities.start(competitionId: 1, teamId: 1, teamName: teamName, state: stamped(steps[first]), staleDate: Date().addingTimeInterval(staleAfter))
                print("[MGDemo] started \(activity.id) at step \(first)")
                if steps[first].endsActivity {
                    try await TeamProgressActivities.update(id: activity.id, state: stamped(steps[first]), staleDate: Date().addingTimeInterval(staleAfter))
                }
                guard fixedStep == nil else { return }
                // Keep stepping for a short while after the user leaves the app, so the Dynamic Island can be seen.
                backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "MGDemoLiveActivity") { endBackgroundTask() }
                let id = activity.id
                timer = Timer.scheduledTimer(withTimeInterval: stepSeconds, repeats: true) { _ in
                    Task { @MainActor in await advance(id: id, staleAfter: staleAfter) }
                }
            } catch {
                print("[MGDemo] could not start: \(error.localizedDescription)")
            }
        }
    }

    @MainActor
    private static func advance(id: String, staleAfter: TimeInterval) async {
        stepIndex += 1
        guard stepIndex < steps.count else {
            timer?.invalidate()
            timer = nil
            endBackgroundTask()
            return
        }
        let state = steps[stepIndex]
        do {
            try await TeamProgressActivities.update(id: id, state: stamped(state), staleDate: Date().addingTimeInterval(staleAfter))
            print("[MGDemo] step \(stepIndex): status \(state.status), heatsUntil \(state.heatsUntil.map(String.init) ?? "nil")")
        } catch {
            print("[MGDemo] step \(stepIndex) failed: \(error.localizedDescription)")
        }
    }

    private static func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
#endif
