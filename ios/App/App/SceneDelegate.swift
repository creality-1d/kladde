import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = KladdeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Bridge view controller that reports Apple Pencil double taps to the web app
/// as a `pencildoubletap` window event with the user's preferred action.
class KladdeViewController: CAPBridgeViewController, UIPencilInteractionDelegate {
    override func viewDidLoad() {
        super.viewDidLoad()
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        view.addInteraction(interaction)
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        let action: String
        switch UIPencilInteraction.preferredTapAction {
        case .switchEraser: action = "eraser"
        case .switchPrevious: action = "previous"
        case .showColorPalette: action = "palette"
        case .ignore: action = "none"
        default: action = "eraser"
        }
        bridge?.triggerWindowJSEvent(eventName: "pencildoubletap", data: "{ \"action\": \"\(action)\" }")
    }
}
