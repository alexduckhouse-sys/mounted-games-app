import ActivityKit
import SwiftUI
import WidgetKit

/// House colours (web/src/theme/skin.css, eguk theme): navy for the card, white text, red only for "on now".
private enum Palette {
    static let navy = Color(red: 23 / 255, green: 56 / 255, blue: 95 / 255)
    static let navyDeep = Color(red: 15 / 255, green: 42 / 255, blue: 74 / 255)
    static let sub = Color(red: 201 / 255, green: 212 / 255, blue: 227 / 255)
    static let faint = Color(red: 175 / 255, green: 192 / 255, blue: 214 / 255)
    static let live = Color(red: 225 / 255, green: 42 / 255, blue: 57 / 255)
    static let warn = Color(red: 217 / 255, green: 119 / 255, blue: 6 / 255)
}

private typealias ProgressState = TeamProgressAttributes.ContentState

private extension ProgressState {
    /// Accent for the symbol: red when the team is on, amber when paused, otherwise the soft header blue.
    var accent: Color {
        switch progressStatus {
        case .inArena where (shownCount ?? 0) == 0: return Palette.live
        case .paused: return Palette.warn
        default: return Palette.sub
        }
    }
}

struct TeamProgressActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TeamProgressAttributes.self) { context in
            LockScreenCard(teamName: context.attributes.teamName, state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Palette.navy)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "figure.equestrian.sports")
                        .font(.title2)
                        .foregroundStyle(Palette.sub)
                        .padding(.leading, 4)
                        .accessibilityHidden(true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CountOrSymbol(state: state, numberSize: 34)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.teamName)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 2) {
                        Text(state.headline)
                            .font(.system(.title3, design: .default, weight: .semibold).width(.condensed))
                        if let line = state.whereLine {
                            Text(line).font(.subheadline).foregroundStyle(Palette.sub).lineLimit(1)
                        }
                        if context.isStale {
                            StaleNote(observedAt: state.observedAt)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            } compactLeading: {
                Image(systemName: "figure.equestrian.sports")
                    .foregroundStyle(Palette.sub)
                    .accessibilityLabel(context.attributes.teamName)
            } compactTrailing: {
                CompactValue(state: state)
                    .opacity(context.isStale ? 0.5 : 1)
            } minimal: {
                CompactValue(state: state)
                    .opacity(context.isStale ? 0.5 : 1)
            }
            .keylineTint(state.accent)
        }
    }
}

/// The lock-screen (and notification banner) card.
private struct LockScreenCard: View {
    let teamName: String
    let state: ProgressState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(teamName)
                        .font(.headline)
                        .foregroundStyle(Palette.sub)
                        .lineLimit(1)
                    Text(state.headline)
                        .font(.system(size: 26, weight: .bold).width(.condensed))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if let subline = state.subline {
                        Text(subline).font(.subheadline).foregroundStyle(Palette.sub).lineLimit(1)
                    }
                    if let line = state.whereLine {
                        Text(line).font(.subheadline.weight(.medium)).foregroundStyle(.white).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                CountOrSymbol(state: state, numberSize: 52)
            }
            if isStale {
                StaleNote(observedAt: state.observedAt)
            }
        }
        .padding(16)
        .opacity(isStale ? 0.75 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.accessibilitySummary(teamName: teamName) + (isStale ? ". May be out of date" : ""))
    }
}

/// The big count with its caption, or a symbol when there is no count to show.
private struct CountOrSymbol: View {
    let state: ProgressState
    let numberSize: CGFloat

    var body: some View {
        if let number = state.bigNumber {
            VStack(spacing: 0) {
                Text(number)
                    .font(.system(size: numberSize, weight: .bold).width(.condensed))
                    .monospacedDigit()
                    .foregroundStyle(state.progressStatus == .paused ? Palette.faint : .white)
                    .contentTransition(.numericText(countsDown: true))
                Text(state.bigNumberCaption)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Palette.sub)
            }
            .accessibilityElement(children: .combine)
        } else {
            Image(systemName: state.symbol)
                .font(.system(size: numberSize * 0.6, weight: .bold))
                .foregroundStyle(state.accent)
                .frame(minWidth: numberSize)
                .accessibilityHidden(true)
        }
    }
}

/// The compact and minimal Dynamic Island value: the count, a short word, or a symbol.
private struct CompactValue: View {
    let state: ProgressState

    var body: some View {
        if let number = state.bigNumber {
            Text(number)
                .font(.system(.body, weight: .bold).width(.condensed))
                .monospacedDigit()
                .foregroundStyle(state.progressStatus == .paused ? Palette.warn : .white)
                .contentTransition(.numericText(countsDown: true))
        } else if let word = state.compactWord {
            Text(word)
                .font(.system(.body, weight: .bold).width(.condensed))
                .foregroundStyle(state.accent)
        } else {
            Image(systemName: state.symbol)
                .foregroundStyle(state.accent)
        }
    }
}

/// Shown once the snapshot's `staleAt` has passed without a newer reading.
private struct StaleNote: View {
    let observedAt: Date?

    var body: some View {
        Label(text, systemImage: "exclamationmark.arrow.circlepath")
            .font(.caption)
            .foregroundStyle(Palette.faint)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
    }

    /// "Last update 10:42. Open MG App to refresh.", in the phone's own time format.
    private var text: String {
        guard let observedAt else { return "May be out of date. Open MG App to refresh." }
        return "Last update \(observedAt.formatted(date: .omitted, time: .shortened)). Open MG App to refresh."
    }
}

// MARK: - Previews (one per state; Xcode canvas only)

private extension TeamProgressAttributes {
    static let preview = TeamProgressAttributes(competitionId: 1, teamId: 1, teamName: "Hollybrook A", startedAt: .now)
}

private extension ProgressState {
    static func make(_ status: TeamProgressStatus, _ count: Int?, heat: String? = "Heat 4", lane: Int? = 3) -> ProgressState {
        ProgressState(status: status.rawValue, sessionId: 1, heatId: heat == nil ? nil : 12, laneIndex: lane, heatsUntil: count, arenaName: "Arena 1", heatLabel: heat, observedAt: .now)
    }

    static let upcoming3 = make(.upcoming, 3)
    static let upcoming1 = make(.upcoming, 1)
    static let next = make(.upcoming, 0)
    static let on = make(.inArena, 0)
    static let paused = make(.paused, 2)
    static let drawPending = make(.drawPending, nil, heat: "A Final", lane: nil)
    static let checking = make(.unknown, nil, heat: nil, lane: nil)
    static let finished = make(.finished, nil, heat: nil, lane: nil)
    static let withdrawn = make(.withdrawn, nil, heat: nil, lane: nil)
}

#Preview("Lock screen", as: .content, using: TeamProgressAttributes.preview) {
    TeamProgressActivityWidget()
} contentStates: {
    ProgressState.upcoming3
    ProgressState.upcoming1
    ProgressState.next
    ProgressState.on
    ProgressState.paused
    ProgressState.drawPending
    ProgressState.checking
    ProgressState.finished
    ProgressState.withdrawn
}

#Preview("Island expanded", as: .dynamicIsland(.expanded), using: TeamProgressAttributes.preview) {
    TeamProgressActivityWidget()
} contentStates: {
    ProgressState.upcoming3
    ProgressState.on
    ProgressState.paused
    ProgressState.drawPending
}

#Preview("Island compact", as: .dynamicIsland(.compact), using: TeamProgressAttributes.preview) {
    TeamProgressActivityWidget()
} contentStates: {
    ProgressState.upcoming3
    ProgressState.next
    ProgressState.on
    ProgressState.paused
    ProgressState.drawPending
    ProgressState.checking
}

#Preview("Island minimal", as: .dynamicIsland(.minimal), using: TeamProgressAttributes.preview) {
    TeamProgressActivityWidget()
} contentStates: {
    ProgressState.upcoming3
    ProgressState.on
    ProgressState.paused
    ProgressState.drawPending
}
