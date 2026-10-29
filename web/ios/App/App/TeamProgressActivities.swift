import ActivityKit
import Foundation
import Security

/// Starts, updates and ends the followed-team Live Activities. Used by the Capacitor plugin and by the
/// DEBUG demo. Native registration observes ActivityKit tokens without relying on the WebView.
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
            await ActivityRegistration.shared.unregister(activity.id)
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        let attributes = TeamProgressAttributes(competitionId: competitionId, teamId: teamId, teamName: teamName, startedAt: Date())
        let activity = try Activity.request(attributes: attributes, content: content(state, staleDate: staleDate), pushType: .token)
        await ActivityRegistration.shared.observe(activity)
        return activity
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
        await ActivityRegistration.shared.unregister(id)
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


/// The capability and unsent registrations live in Keychain. A suspended WebView is not involved.
actor ActivityRegistration {
    static let shared = ActivityRegistration()
    private var observed = Set<String>()
    private var flushing = false
    private var queueVersion = 0
    private let base = URL(string: "https://mounted-games-app.vercel.app/api/apple/")!
    private struct Installation: Codable { let installationId: String; let capability: String }
    private struct Pending: Codable {
        let activityId: String; let competitionId: Int; let teamId: Int; let pushToken: String
        let sandbox: Bool; let startedAt: String; var removed: Bool
    }
    private var pending: [String: Pending] {
        get { guard let data = read("pending") else { return [:] }; return (try? JSONDecoder().decode([String: Pending].self, from: data)) ?? [:] }
        set { if let data = try? JSONEncoder().encode(newValue) { write(data, "pending"); queueVersion += 1 } }
    }
    func resume() async {
        for activity in Activity<TeamProgressAttributes>.activities { await observe(activity) }
        let running = Set(Activity<TeamProgressAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }.map { $0.id })
        var queue = pending
        for (id, var item) in queue where !running.contains(id) { item.removed = true; queue[id] = item }
        pending = queue
        await flush()
    }
    func observe(_ activity: Activity<TeamProgressAttributes>) async {
        guard observed.insert(activity.id).inserted else { return }
        if let token = activity.pushToken { await register(activity, token: token) }
        Task {
            for await token in activity.pushTokenUpdates { await self.register(activity, token: token) }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                await self.unregister(activity.id)
            }
        }
    }
    private func register(_ activity: Activity<TeamProgressAttributes>, token: Data) async {
        #if DEBUG
        let sandbox = true
        #else
        let sandbox = false
        #endif
        var queue = pending
        queue[activity.id] = Pending(activityId: activity.id, competitionId: activity.attributes.competitionId,
            teamId: activity.attributes.teamId, pushToken: token.map { String(format: "%02x", $0) }.joined(),
            sandbox: sandbox, startedAt: ISO8601DateFormatter().string(from: activity.attributes.startedAt), removed: false)
        pending = queue
        await flush()
    }
    func unregister(_ id: String) async {
        var queue = pending
        if var item = queue[id] { item.removed = true; queue[id] = item; pending = queue }
        await flush()
    }
    private func installation() async throws -> Installation {
        if let data = read("installation"), let value = try? JSONDecoder().decode(Installation.self, from: data) { return value }
        var request = URLRequest(url: base.appendingPathComponent("installations")); request.httpMethod = "POST"
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let value = try JSONDecoder().decode(Installation.self, from: data); write(data, "installation"); return value
    }
    private func flush() async {
        guard !flushing else { return }; flushing = true
        defer { flushing = false }
        // Retry while native runtime is available; resume() retries the durable queue after suspension.
        for attempt in 0..<4 {
            do {
                let identity = try await installation()
                let sentVersion = queueVersion
                for (id, item) in pending.sorted(by: { $0.value.removed && !$1.value.removed }) {
                    let path = "installations/\(identity.installationId)/activities" + (item.removed ? "/\(id)" : "")
                    var request = URLRequest(url: base.appendingPathComponent(path)); request.httpMethod = item.removed ? "DELETE" : "PUT"
                    request.timeoutInterval = 15
                    request.setValue("AppleInstallation \(identity.capability)", forHTTPHeaderField: "Authorization")
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    if !item.removed { request.httpBody = try JSONEncoder().encode(item) }
                    let (_, response) = try await URLSession.shared.data(for: request)
                    guard let code = (response as? HTTPURLResponse)?.statusCode else { throw URLError(.badServerResponse) }
                    if code == 401 { erase("installation"); throw URLError(.userAuthenticationRequired) }
                    guard (200..<300).contains(code) || (item.removed && code == 404) else { throw URLError(.badServerResponse) }
                    // Keep accepted active tokens so later dismissal has enough information to unregister.
                    if item.removed { var queue = pending; if queue[id]?.removed == true { queue.removeValue(forKey: id); pending = queue } }
                }
                if queueVersion != sentVersion { continue }
                return
            } catch {
                if attempt < 3 { try? await Task.sleep(for: .seconds(pow(3.0, Double(attempt)))) }
            }
        }
    }
    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "mg.apple.activities", kSecAttrAccount as String: key]
    }
    private func read(_ key: String) -> Data? {
        var q = query(key); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?; return SecItemCopyMatching(q as CFDictionary, &value) == errSecSuccess ? value as? Data : nil
    }
    private func write(_ data: Data, _ key: String) {
        let q = query(key); let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        if SecItemUpdate(q as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(q.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
    }
    private func erase(_ key: String) { SecItemDelete(query(key) as CFDictionary) }
}
