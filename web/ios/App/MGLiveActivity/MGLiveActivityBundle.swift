import SwiftUI
import WidgetKit

/// The widget extension holds only the followed-team Live Activity; there are no home-screen widgets.
@main
struct MGLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        TeamProgressActivityWidget()
    }
}
