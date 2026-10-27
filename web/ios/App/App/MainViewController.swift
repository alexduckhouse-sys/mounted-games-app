import Capacitor
import UIKit

/// The app's web view. Capacitor finds npm plugins itself; plugins that live in the app are registered here.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
