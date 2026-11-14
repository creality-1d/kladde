import UIKit
import Capacitor
import Vision

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
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KladdePlugin())
    }

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

/// Native helpers for the web app: the system share sheet (WKWebView has neither
/// downloads nor a reliable Web Share API) and on-device handwriting recognition.
@objc(KladdePlugin)
public class KladdePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KladdePlugin"
    public let jsName = "Kladde"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    /// Recognises text in a PNG (base64) with Vision, on the device. Boxes are
    /// returned in 0…1 of the image with the origin at the top left.
    @objc func recognize(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"),
              let data = Data(base64Encoded: encoded),
              let image = UIImage(data: data)?.cgImage else {
            call.reject("data must be a base64 PNG")
            return
        }
        let wanted = (call.options["languages"] as? [String]) ?? ["de-DE", "en-US"]
        DispatchQueue.global(qos: .utility).async {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let supported = (try? request.supportedRecognitionLanguages()) ?? []
            let languages = wanted.filter { supported.contains($0) }
            if !languages.isEmpty { request.recognitionLanguages = languages }
            do {
                try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
            } catch {
                call.reject(error.localizedDescription)
                return
            }
            let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
                guard let best = observation.topCandidates(1).first else { return nil }
                let box = observation.boundingBox
                return ["text": best.string, "x": box.minX, "y": 1 - box.maxY, "w": box.width, "h": box.height]
            }
            call.resolve(["lines": lines])
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let name = call.getString("name"),
              let encoded = call.getString("data"),
              let data = Data(base64Encoded: encoded) else {
            call.reject("name and data are required")
            return
        }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        let url = folder.appendingPathComponent(safe)
        do {
            try? FileManager.default.removeItem(at: folder)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject(error.localizedDescription)
            return
        }
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else {
                call.reject("no view controller")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = controller.view
                popover.sourceRect = CGRect(x: controller.view.bounds.maxX - 80, y: 60, width: 1, height: 1)
                popover.permittedArrowDirections = [.up]
            }
            sheet.completionWithItemsHandler = { _, completed, _, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["completed": completed])
                }
            }
            controller.present(sheet, animated: true)
        }
    }
}
