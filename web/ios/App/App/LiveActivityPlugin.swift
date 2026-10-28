import ActivityKit
import Capacitor
import Foundation

/// The `LiveActivity` plugin used by `src/native/liveActivity.ts`: start, update, end and list the
/// followed-team cards. Values mirror the TeamProgress DTO (numbers on the wire, camelCase).
/// Registered in `MainViewController`, as Capacitor expects for plugins that live in the app itself.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
    ]

    private static let isoWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoPlain = ISO8601DateFormatter()

    @objc func start(_ call: CAPPluginCall) {
        guard let competitionId = call.getInt("competitionId"), let teamId = call.getInt("teamId") else {
            return call.reject("competitionId and teamId are required")
        }
        guard let teamName = call.getString("teamName")?.trimmingCharacters(in: .whitespacesAndNewlines), !teamName.isEmpty else {
            return call.reject("teamName is required")
        }
        guard let state = Self.state(from: call.getObject("state")) else {
            return call.reject("state is missing or has an unknown status")
        }
        if state.endsActivity { return call.reject("A finished or withdrawn team has nothing to follow") }
        let staleDate = Self.staleDate(call)
        Task {
            do {
                let activity = try await TeamProgressActivities.start(competitionId: competitionId, teamId: teamId, teamName: teamName, state: state, staleDate: staleDate)
                call.resolve(["activityId": activity.id])
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let id = call.getString("activityId") else { return call.reject("activityId is required") }
        guard let state = Self.state(from: call.getObject("state")) else {
            return call.reject("state is missing or has an unknown status")
        }
        let staleDate = Self.staleDate(call)
        Task {
            do {
                try await TeamProgressActivities.update(id: id, state: state, staleDate: staleDate)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard let id = call.getString("activityId") else { return call.reject("activityId is required") }
        let given = call.getObject("state")
        let state = Self.state(from: given)
        if given != nil && state == nil { return call.reject("state has an unknown status") }
        let immediately = call.getBool("immediately") ?? false
        Task {
            do {
                try await TeamProgressActivities.end(id: id, state: state, immediately: immediately)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        let activities: [[String: Any]] = TeamProgressActivities.running
            .filter { $0.activityState == .active || $0.activityState == .stale }
            .map { activity in
                [
                    "activityId": activity.id,
                    "competitionId": activity.attributes.competitionId,
                    "teamId": activity.attributes.teamId,
                    "teamName": activity.attributes.teamName,
                    "startedAt": Self.isoWithFraction.string(from: activity.attributes.startedAt),
                    "state": Self.object(from: activity.content.state),
                ]
            }
        call.resolve(["enabled": TeamProgressActivities.enabled, "activities": activities])
    }

    /// The snapshot's `staleAt`, or a minute from now if it's missing or unreadable.
    private static func staleDate(_ call: CAPPluginCall) -> Date {
        call.getString("staleAt").flatMap(date(from:)) ?? Date().addingTimeInterval(TeamProgressActivities.fallbackStaleAfter)
    }

    /// Reads the API's UTC ISO times, with or without fractional seconds.
    static func date(from text: String) -> Date? {
        isoWithFraction.date(from: text) ?? isoPlain.date(from: text)
    }

    /// Reads a state sent from the page. JSON null arrives as NSNull, which these casts turn into nil.
    static func state(from object: JSObject?) -> TeamProgressAttributes.ContentState? {
        guard let object, let status = object["status"] as? Int, TeamProgressStatus(rawValue: status) != nil else { return nil }
        return TeamProgressAttributes.ContentState(
            status: status,
            sessionId: object["sessionId"] as? Int,
            heatId: object["heatId"] as? Int,
            laneIndex: object["laneIndex"] as? Int,
            heatsUntil: object["heatsUntil"] as? Int,
            arenaName: object["arenaName"] as? String,
            heatLabel: object["heatLabel"] as? String,
            observedAt: (object["observedAt"] as? String).flatMap(date(from:))
        )
    }

    /// The same shape back to the page, with nulls kept so the TS type's fields are always present.
    static func object(from state: TeamProgressAttributes.ContentState) -> [String: Any] {
        [
            "status": state.status,
            "sessionId": state.sessionId ?? NSNull(),
            "heatId": state.heatId ?? NSNull(),
            "laneIndex": state.laneIndex ?? NSNull(),
            "heatsUntil": state.heatsUntil ?? NSNull(),
            "arenaName": state.arenaName ?? NSNull(),
            "heatLabel": state.heatLabel ?? NSNull(),
            "observedAt": state.observedAt.map { isoWithFraction.string(from: $0) } ?? NSNull(),
        ]
    }
}
