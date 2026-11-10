import AppKit
import WebKit
import Network

// All web resources stay local. An ephemeral loopback listener gives ES modules a
// normal origin without weakening WebKit file-origin security or requiring Python.
final class LocalAssetServer {
    private let root: URL
    private let queue = DispatchQueue(label: "local.seasons.assets", qos: .userInitiated)
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]

    init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath() }

    func start(_ completion: @escaping (Result<UInt16, Error>) -> Void) {
        do {
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
            let listener = try NWListener(using: parameters)
            self.listener = listener
            var didReport = false
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if !didReport, let port = listener.port?.rawValue {
                        didReport = true
                        DispatchQueue.main.async { completion(.success(port)) }
                    }
                case .failed(let error):
                    if !didReport {
                        didReport = true
                        DispatchQueue.main.async { completion(.failure(error)) }
                    }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self = self else { connection.cancel(); return }
                let id = UUID()
                self.connections[id] = connection
                connection.stateUpdateHandler = { [weak self] state in
                    switch state {
                    case .failed, .cancelled: self?.connections.removeValue(forKey: id)
                    default: break
                    }
                }
                connection.start(queue: self.queue)
                self.receive(connection, accumulated: Data())
            }
            listener.start(queue: queue)
        } catch { completion(.failure(error)) }
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] bytes, _, complete, error in
            guard let self = self else { connection.cancel(); return }
            var data = accumulated
            if let bytes = bytes { data.append(bytes) }
            guard data.count <= 32768 else { connection.cancel(); return }
            if let header = String(data: data, encoding: .utf8), header.contains("\r\n\r\n") {
                self.respond(connection, request: header)
            } else if complete || error != nil { connection.cancel() }
            else { self.receive(connection, accumulated: data) }
        }
    }

    private func respond(_ connection: NWConnection, request: String) {
        let tokens = request.components(separatedBy: "\r\n")[0].split(separator: " ")
        guard tokens.count >= 2 else { connection.cancel(); return }
        let method = String(tokens[0])
        guard method == "GET" || method == "HEAD" else {
            send(connection, status: "405 Method Not Allowed", type: "text/plain", data: Data("Method not allowed".utf8)); return
        }
        let rawPath = String(tokens[1]).components(separatedBy: "?")[0]
        guard let path = rawPath.removingPercentEncoding, !path.contains("\0") else { connection.cancel(); return }
        let relative = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        let url = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard url.path.hasPrefix(root.path + "/") else {
            send(connection, status: "403 Forbidden", type: "text/plain", data: Data()); return
        }
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            send(connection, status: "404 Not Found", type: "text/plain", data: Data("Not found".utf8)); return
        }
        let mime: [String: String] = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "json": "application/json", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml", "woff2": "font/woff2", "mp4": "video/mp4"]
        send(connection, status: "200 OK", type: mime[url.pathExtension.lowercased()] ?? "application/octet-stream", data: data, headOnly: method == "HEAD")
    }

    private func send(_ connection: NWConnection, status: String, type: String, data: Data, headOnly: Bool = false) {
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        var payload = Data(header.utf8)
        if !headOnly { payload.append(data) }
        connection.send(content: payload, completion: .contentProcessed { _ in connection.cancel() })
    }

    func stop() {
        listener?.cancel()
        queue.async { [weak self] in
            guard let self = self else { return }
            for connection in Array(self.connections.values) { connection.cancel() }
            self.connections.removeAll()
        }
    }
}

final class OrnamentPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class ClearWebView: WKWebView {
    override var isOpaque: Bool { false }
}

// Hover chrome is a separate native view, never painted into exported artwork.
// Only the close button accepts hits; the monitor arbitrates artwork gestures.
final class OrnamentChromeView: NSView {
    enum Corner: String { case bottomLeft, bottomRight, topLeft, topRight }
    var hovered = false { didSet { closeButton.isHidden = !hovered; needsDisplay = true } }
    var manipulating = false { didSet { needsDisplay = true } }
    var introduction = true { didSet { needsDisplay = true } }
    let closeButton = NSButton()
    var closeButtonRect: NSRect { NSRect(x:bounds.width-53,y:bounds.height-53,width:28,height:28) }
    private var tracking: NSTrackingArea?
    override init(frame: NSRect) {
        super.init(frame:frame)
        closeButton.image = NSImage(systemSymbolName:"xmark",accessibilityDescription:"隐藏 Seasonote")
        closeButton.imageScaling = .scaleProportionallyDown
        closeButton.isBordered = false
        closeButton.contentTintColor = .white
        closeButton.wantsLayer = true
        closeButton.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
        closeButton.layer?.cornerRadius = 14
        closeButton.toolTip = "隐藏转盘 · 点击 Dock 中的 Seasonote 可重新打开"
        closeButton.setAccessibilityLabel("隐藏 Seasonote")
        closeButton.isHidden = true
        addSubview(closeButton)
    }
    required init?(coder:NSCoder) { fatalError("init(coder:) is not used") }
    override func layout() { super.layout(); closeButton.frame = closeButtonRect }
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point,from:superview)
        return hovered && closeButtonRect.contains(local) ? closeButton : nil
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area); tracking = area
    }
    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }
    func corner(at point: NSPoint) -> Corner? {
        let edge: CGFloat = 25
        guard bounds.contains(point) else { return nil }
        if point.x <= edge && point.y <= edge { return .bottomLeft }
        if point.x >= bounds.width-edge && point.y <= edge { return .bottomRight }
        if point.x <= edge && point.y >= bounds.height-edge { return .topLeft }
        if point.x >= bounds.width-edge && point.y >= bounds.height-edge { return .topRight }
        return nil
    }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill(); dirtyRect.fill(using: .copy)
        guard hovered || manipulating || introduction else { return }
        let outline = NSBezierPath(roundedRect: bounds.insetBy(dx: 9, dy: 9), xRadius: 12, yRadius: 12)
        NSColor.white.withAlphaComponent(0.30).setStroke(); outline.lineWidth = 1; outline.stroke()
        for point in [NSPoint(x: 9,y: 9),NSPoint(x: bounds.width-9,y: 9),NSPoint(x: 9,y: bounds.height-9),NSPoint(x: bounds.width-9,y: bounds.height-9)] {
            let handle = NSBezierPath(roundedRect: NSRect(x:point.x-4,y:point.y-4,width:8,height:8), xRadius:2,yRadius:2)
            NSColor.white.withAlphaComponent(0.92).setFill(); handle.fill()
            NSColor.black.withAlphaComponent(0.25).setStroke(); handle.lineWidth = 0.5; handle.stroke()
        }
        let hint = "拖动移动 · 四角缩放 · Shift 拖动指针"
        let attributes: [NSAttributedString.Key: Any] = [.font:NSFont.systemFont(ofSize:11,weight:.medium),.foregroundColor:NSColor.white.withAlphaComponent(0.92)]
        let size = (hint as NSString).size(withAttributes: attributes)
        let rect = NSRect(x:(bounds.width-size.width-22)/2,y:bounds.height-43,width:size.width+22,height:24)
        NSColor.black.withAlphaComponent(0.48).setFill()
        NSBezierPath(roundedRect:rect,xRadius:12,yRadius:12).fill()
        (hint as NSString).draw(at:NSPoint(x:rect.minX+11,y:rect.minY+5),withAttributes:attributes)
    }
}

final class SeasonDesktop: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSWindowDelegate, WKScriptMessageHandler {
    private var musicBridge: MusicBridge?
    private var musicTimer: Timer?
    private var musicReady = false
    private var musicControlHeight: CGFloat = 0
    private var lastArtwork: String?
    private var artworkWasSent = false
    private var panel: OrnamentPanel!
    private var webView: ClearWebView!
    private var statusItem: NSStatusItem!
    private var controlWindow: NSWindow?
    private var visibilityButton: NSButton?
    private var visibilityLabel: NSTextField?
    private var visibilityMenuItem: NSMenuItem?
    private var desktopEnabled = true
    private var assetServer: LocalAssetServer?
    private var dragMonitor: Any?
    private var chrome: OrnamentChromeView!
    private var gestureDown: NSPoint?
    private var gestureFrame = NSRect.zero
    private var gestureClientPoint = NSPoint.zero
    private var resizeCorner: OrnamentChromeView.Corner?
    private var movedDuringGesture = false
    private var webGesture = false
    private var lastPlacementAction = "restored"
    private var pointerCounts: [String:Int] = ["down":0,"drag":0,"up":0]
    private var lastPointerEventType = "none"
    private var lastPointerLocation: [String:Double] = [:]
    private var localURL: URL?
    private var snapshotScheduled = false
    private var diagnosticTimer: Timer?
    private func argument(_ name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }
    private func startDiagnostics() {
        guard let path = argument("--diagnose") else { return }
        FileManager.default.createFile(atPath: path, contents: Data())
        diagnosticTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let script = "JSON.stringify({ready:window.appReady,hidden:document.hidden,visibility:document.visibilityState,frame:window.seasonScene?.frame,phase:window.seasonScene?.phase,playing:window.seasonScene?.playing,elapsed:window.seasonScene?.elapsed,state:window.seasonScene?.state,glPrograms:window.seasonScene?.renderer?.info?.programs?.length,glFailures:window.seasonScene?.renderer?.info?.programs?.filter(p=>p.diagnostics?.runnable===false).length,music:window.musicState,musicArtwork:!!window.scene?._musicTexture,musicOpacity:document.querySelector('.music-controls')?getComputedStyle(document.querySelector('.music-controls')).opacity:null,errors:window.__nativeErrors})"
            self.webView.evaluateJavaScript(script) { value, error in
                var record: [String: Any] = ["time": ISO8601DateFormatter().string(from: Date()), "pid": ProcessInfo.processInfo.processIdentifier, "nativeVisible": self.panel.isVisible, "occlusionVisible": self.panel.occlusionState.contains(.visible), "appActive": NSApp.isActive, "level": self.panel.level.rawValue, "window": self.panel.windowNumber, "frontmost": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "", "webViewHidden": self.webView.isHiddenOrHasHiddenAncestor]
                let frame = self.panel.frame
                record["windowFrame"] = ["x":frame.origin.x,"y":frame.origin.y,"width":frame.width,"height":frame.height]
                record["lastPlacementAction"] = self.lastPlacementAction
                record["nativeGesture"] = self.gestureDown != nil
                record["pointerCounts"] = self.pointerCounts
                record["lastPointerEventType"] = self.lastPointerEventType
                record["lastEventLocation"] = self.lastPointerLocation
                record["chromeVisible"] = self.chrome.hovered || self.chrome.manipulating || self.chrome.introduction
                record["desktopEnabled"] = self.desktopEnabled
                record["controlVisible"] = self.controlWindow?.isVisible ?? false
                record["closeVisible"] = !self.chrome.closeButton.isHidden
                record["dockEntry"] = NSApp.activationPolicy() == .regular
                record["musicControlHeight"] = self.musicControlHeight
                if let value = value as? String, let data = value.data(using: .utf8), let report = try? JSONSerialization.jsonObject(with: data) { record["web"] = report }
                if let error = error { record["error"] = error.localizedDescription }
                guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]), let file = FileHandle(forWritingAtPath: path) else { return }
                file.seekToEndOfFile(); file.write(data); file.write(Data([10])); file.closeFile()
            }
        }
    }
    private var snapshotPath: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--snapshot"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if let icon = Bundle.main.url(forResource:"Seasonote",withExtension:"icns") {
            NSApp.applicationIconImage = NSImage(contentsOf:icon)
        }
        // Launching the application is the user's explicit "open" action.
        desktopEnabled = true
        UserDefaults.standard.set(false,forKey:"DesktopHidden")
        setupStatusMenu()
        setupPanel()
        let bridge = MusicBridge(resource: Bundle.main.resourceURL!)
        musicBridge = bridge
        bridge.onChange = { [weak self] in self?.pushMusicState() }
        bridge.start()
        musicTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.pushMusicState() }
        let bundleRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
        let adjacentRoot = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        let root = FileManager.default.fileExists(atPath: bundleRoot.appendingPathComponent("index.html").path) ? bundleRoot : adjacentRoot
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            showError("找不到动画文件。请保留 seasons 文件夹完整，并重新运行打开桌面摆件.command。")
            return
        }
        assetServer = LocalAssetServer(root: root)
        assetServer?.start { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let port):
                let url = URL(string: "http://127.0.0.1:\(port)/index.html?mode=widget")!
                self.localURL = url
                self.webView.load(URLRequest(url: url))
            case .failure(let error): self.showError("本地动画服务无法启动：\(error.localizedDescription)")
            }
        }
        if snapshotPath == nil && !UserDefaults.standard.bool(forKey:"SeasonoteWelcomeShown") {
            showControls()
            UserDefaults.standard.set(true,forKey:"SeasonoteWelcomeShown")
        }
        if snapshotPath == nil && !UserDefaults.standard.bool(forKey:"DesktopShortcutCreated") {
            if createDesktopShortcut(silent:true) { UserDefaults.standard.set(true,forKey:"DesktopShortcutCreated") }
        }
    }

    private func setupPanel() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(x: screen.minX + screen.width * 0.22, y: screen.minY + screen.height * 0.30, width: 640, height: 510)
        panel = OrnamentPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Seasonote"
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.delegate = self
        // Borderless panels are not system-resizable. AppKit requires force:true
        // to restore their saved size; restore before enabling automatic saving.
        panel.setFrameUsingName("SeasonOrnamentFrame", force:true)
        panel.setFrameAutosaveName("SeasonOrnamentFrame")
        if !NSScreen.screens.contains(where: { $0.visibleFrame.intersects(panel.frame) }) { panel.setFrame(frame, display: false) }

        let configuration = WKWebViewConfiguration()
        let script = WKUserScript(source: "window.__SEASONS_WIDGET__ = true; window.__nativeErrors = []; window.addEventListener('error', e => window.__nativeErrors.push(e.message)); window.addEventListener('unhandledrejection', e => window.__nativeErrors.push(String(e.reason)));", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.addUserScript(script)
        configuration.userContentController.add(self, name: "seasonsMusic")
        webView = ClearWebView(frame: NSRect(origin: .zero, size: panel.frame.size), configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        let container = NSView(frame:NSRect(origin:.zero,size:panel.frame.size))
        container.addSubview(webView)
        chrome = OrnamentChromeView(frame:container.bounds)
        chrome.autoresizingMask = [.width,.height]
        chrome.wantsLayer = true
        chrome.layer?.backgroundColor = NSColor.clear.cgColor
        chrome.closeButton.target = self
        chrome.closeButton.action = #selector(hideDesktop)
        chrome.toolTip = "直接拖动移动；拖动四角调整大小；按住 Shift 拖动指针调整季节。"
        container.addSubview(chrome, positioned:.above, relativeTo:webView)
        panel.contentView = container
        DispatchQueue.main.asyncAfter(deadline:.now()+5) { [weak self] in self?.chrome.introduction = false }
        applyLevel()
        applyDesktopVisibility()
        startDiagnostics()

        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown,.leftMouseDragged,.leftMouseUp,.mouseMoved]) { [weak self] event in
            guard let self = self else { return event }
            return self.handlePointer(event)
        }
    }

    private func handlePointer(_ event: NSEvent) -> NSEvent? {
        // Event-local positions also work with accessibility-generated drags,
        // whose global hardware cursor position may intentionally stay fixed.
        let eventScreenPoint = event.window?.convertPoint(toScreen:event.locationInWindow) ?? NSEvent.mouseLocation
        if event.window === panel || gestureDown != nil || webGesture {
            let kind: String? = event.type == .leftMouseDown ? "down" : event.type == .leftMouseDragged ? "drag" : event.type == .leftMouseUp ? "up" : nil
            if let kind = kind {
                pointerCounts[kind,default:0] += 1
                lastPointerEventType = kind
                lastPointerLocation = ["screenX":eventScreenPoint.x,"screenY":eventScreenPoint.y,"windowX":event.locationInWindow.x,"windowY":event.locationInWindow.y]
            }
        }
        if event.type == .mouseMoved {
            guard event.window === panel else { return event }
            let local = chrome.convert(event.locationInWindow, from:nil)
            chrome.hovered = chrome.bounds.contains(local)
            if chrome.closeButtonRect.contains(local) { NSCursor.pointingHand.set(); return event }
            if chrome.corner(at:local) != nil { NSCursor.crosshair.set(); return nil }
            NSCursor.arrow.set()
            return event
        }
        if event.type == .leftMouseDown {
            guard event.window === panel else { return event }
            let local = chrome.convert(event.locationInWindow, from:nil)
            let corner = chrome.corner(at:local)
            if chrome.hovered && chrome.closeButtonRect.contains(local) {
                webGesture = true
                return event
            }
            // A Shift gesture goes to WebKit from its original down through up.
            if (event.modifierFlags.contains(.shift) || local.y < musicControlHeight) && corner == nil {
                webGesture = true
                return event
            }
            webGesture = false
            gestureDown = eventScreenPoint
            gestureFrame = panel.frame
            resizeCorner = corner
            movedDuringGesture = false
            let webPoint = webView.convert(event.locationInWindow, from:nil)
            gestureClientPoint = NSPoint(x:webPoint.x,y:webView.isFlipped ? webPoint.y : webView.bounds.height-webPoint.y)
            chrome.hovered = true
            chrome.manipulating = true
            return nil
        }
        if webGesture {
            if event.type == .leftMouseUp { webGesture = false }
            return event
        }
        guard let down = gestureDown else { return event }
        if event.type == .leftMouseDragged {
            let current = eventScreenPoint
            let delta = NSPoint(x:current.x-down.x,y:current.y-down.y)
            if !movedDuringGesture && hypot(delta.x,delta.y)<4 { return nil }
            movedDuringGesture = true
            if let corner = resizeCorner { resizeFromCorner(corner,delta:delta) }
            else {
                NSCursor.closedHand.set()
                panel.setFrameOrigin(NSPoint(x:gestureFrame.minX+delta.x,y:gestureFrame.minY+delta.y))
            }
            return nil
        }
        if event.type == .leftMouseUp {
            if movedDuringGesture {
                lastPlacementAction = resizeCorner == nil ? "moved" : "resized"
                persistPlacement()
            } else if resizeCorner == nil {
                sendArtworkClick(gestureClientPoint)
            }
            gestureDown = nil; resizeCorner = nil; movedDuringGesture = false
            chrome.manipulating = false
            chrome.hovered = chrome.bounds.contains(chrome.convert(panel.convertPoint(fromScreen:eventScreenPoint),from:nil))
            NSCursor.arrow.set()
            return nil
        }
        return event
    }

    private func resizeFromCorner(_ corner: OrnamentChromeView.Corner, delta: NSPoint) {
        let left = corner == .bottomLeft || corner == .topLeft
        let bottom = corner == .bottomLeft || corner == .bottomRight
        let dw = delta.x * (left ? -1 : 1)
        let dh = delta.y * (bottom ? -1 : 1)
        let widthRatio = dw/gestureFrame.width, heightRatio = dh/gestureFrame.height
        var scale = 1+(abs(widthRatio)>abs(heightRatio) ? widthRatio : heightRatio)
        let screen = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1440,height:900)
        let minimum = max(320/gestureFrame.width,240/gestureFrame.height)
        let maximum = max(minimum,min((screen.width-16)/gestureFrame.width,(screen.height-16)/gestureFrame.height))
        scale = max(minimum,min(scale,maximum))
        let width = gestureFrame.width*scale, height = gestureFrame.height*scale
        var frame = NSRect(x:left ? gestureFrame.maxX-width : gestureFrame.minX,y:bottom ? gestureFrame.maxY-height : gestureFrame.minY,width:width,height:height)
        frame.origin.x = max(screen.minX,min(frame.minX,screen.maxX-width))
        frame.origin.y = max(screen.minY,min(frame.minY,screen.maxY-height))
        panel.setFrame(frame,display:true)
    }

    private func sendArtworkClick(_ point: NSPoint) {
        let value: [String:Any] = ["x":point.x,"y":point.y]
        guard let bytes = try? JSONSerialization.data(withJSONObject:value), let json = String(data:bytes,encoding:.utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('seasons-native-click',{detail:\(json)}));",completionHandler:nil)
    }

    private func pushMusicState() {
        guard musicReady, let bridge = musicBridge else { return }
        let s = bridge.state
        let source = s["bundleIdentifier"] as? String ?? ""
        let sourceRunning = !source.isEmpty && !NSRunningApplication.runningApplications(withBundleIdentifier:source).isEmpty
        var value: [String:Any] = ["connected":sourceRunning && bridge.error.isEmpty,
            "playing":bridge.playing, "title":s["title"] as? String ?? "", "artist":s["artist"] as? String ?? "",
            "source":s["bundleIdentifier"] as? String ?? "", "position":bridge.position as Any? ?? NSNull(),
            "duration":bridge.duration as Any? ?? NSNull(), "error":bridge.error,
            "commandError":bridge.lastCommand.contains("失败") ? bridge.lastCommand : ""]
        let art = s["artworkData"] as? String
        if !artworkWasSent || art != lastArtwork {
            lastArtwork = art; artworkWasSent = true
            if let art, let mime = s["artworkMimeType"] as? String, ["image/jpeg","image/png","image/webp"].contains(mime) {
                value["artwork"] = "data:\(mime);base64,\(art)"
            } else { value["artwork"] = NSNull() }
        }
        guard let data = try? JSONSerialization.data(withJSONObject:value), let json = String(data:data,encoding:.utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('seasons-music-state',{detail:\(json)}));", completionHandler:nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "seasonsMusic", message.frameInfo.isMainFrame,
              let origin = message.frameInfo.request.url, origin.host == "127.0.0.1", origin.port == localURL?.port,
              let body = message.body as? [String:Any], let action = body["action"] as? String else { return }
        if action == "refresh" { musicReady = true; artworkWasSent = false; musicBridge?.refresh(); pushMusicState() }
        else if action == "layout", let visible = body["visible"] as? Bool, let height = body["height"] as? Double, height.isFinite {
            musicControlHeight = visible ? min(max(CGFloat(height),0),panel.frame.height) : 0
        }
        else if ["play","pause","toggle","next","previous","seek"].contains(action) {
            musicBridge?.command(action, seconds:body["value"] as? Double)
        }
    }

    private func persistPlacement() {
        panel.saveFrame(usingName:"SeasonOrnamentFrame")
    }

    private func applyDesktopVisibility() {
        guard let panel else { return }
        if desktopEnabled { panel.orderFrontRegardless() }
        else {
            panel.orderOut(nil)
            gestureDown = nil; resizeCorner = nil; webGesture = false
            chrome?.hovered = false; chrome?.manipulating = false
        }
        let action = desktopEnabled ? "隐藏桌面转盘" : "显示桌面转盘"
        visibilityButton?.title = action
        visibilityMenuItem?.title = action
        visibilityLabel?.stringValue = desktopEnabled ? "桌面转盘：显示中" : "桌面转盘：已隐藏"
    }

    @objc private func toggleDesktopVisibility() {
        desktopEnabled.toggle()
        UserDefaults.standard.set(!desktopEnabled, forKey: "DesktopHidden")
        applyDesktopVisibility()
    }

    @objc private func hideDesktop() {
        desktopEnabled = false
        UserDefaults.standard.set(true,forKey:"DesktopHidden")
        applyDesktopVisibility()
    }

    @objc private func showDesktop() {
        desktopEnabled = true
        UserDefaults.standard.set(false,forKey:"DesktopHidden")
        applyDesktopVisibility()
    }

    @discardableResult private func createDesktopShortcut(silent:Bool) -> Bool {
        do {
            let desktop = try FileManager.default.url(for:.desktopDirectory,in:.userDomainMask,appropriateFor:nil,create:false)
            let destination = desktop.appendingPathComponent("Seasonote")
            let target = Bundle.main.bundleURL.standardizedFileURL
            if FileManager.default.fileExists(atPath:destination.path) {
                let existing = try? URL(resolvingAliasFileAt:destination,options:[.withoutUI,.withoutMounting])
                guard existing?.standardizedFileURL == target else {
                    throw NSError(domain:"Seasonote",code:1,userInfo:[NSLocalizedDescriptionKey:"桌面已有名为 Seasonote 的其他文件，请先为它改名，再创建入口。"])
                }
            } else {
                let bookmark = try target.bookmarkData(options:.suitableForBookmarkFile,includingResourceValuesForKeys:nil,relativeTo:nil)
                try URL.writeBookmarkData(bookmark,to:destination)
            }
            if !silent {
                let alert = NSAlert(); alert.messageText = "已创建桌面入口"
                alert.informativeText = "双击桌面的 Seasonote 草坪转盘图标即可打开。"; alert.runModal()
            }
            return true
        } catch {
            if !silent {
                let alert = NSAlert(); alert.messageText = "暂时无法创建桌面入口"
                alert.informativeText = error.localizedDescription; alert.runModal()
            }
            return false
        }
    }

    @objc private func createDesktopShortcutFromMenu() {
        if createDesktopShortcut(silent:false) { UserDefaults.standard.set(true,forKey:"DesktopShortcutCreated") }
    }

    @objc private func showControls() {
        if controlWindow == nil {
            let window = NSWindow(contentRect: NSRect(x:0,y:0,width:420,height:250),
                                  styleMask:[.titled,.closable,.miniaturizable], backing:.buffered, defer:false)
            window.title = "Seasonote · 开关"
            window.isReleasedWhenClosed = false
            window.center()
            let root = window.contentView!
            let heading = NSTextField(labelWithString:"Seasonote")
            heading.font = .systemFont(ofSize:24,weight:.semibold)
            heading.frame = NSRect(x:26,y:191,width:368,height:34); root.addSubview(heading)
            let label = NSTextField(labelWithString:"")
            label.font = .systemFont(ofSize:14,weight:.medium)
            label.frame = NSRect(x:26,y:159,width:368,height:24); root.addSubview(label)
            visibilityLabel = label
            let hint = NSTextField(wrappingLabelWithString:"移入转盘，点击右上角 × 收起。双击桌面或点击 Dock 中的 Seasonote 图标重新显示。")
            hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize:12)
            hint.frame = NSRect(x:26,y:120,width:368,height:34); root.addSubview(hint)
            let toggle = NSButton(title:"",target:self,action:#selector(toggleDesktopVisibility))
            toggle.bezelStyle = .rounded; toggle.controlSize = .large
            toggle.frame = NSRect(x:26,y:69,width:368,height:40); root.addSubview(toggle)
            visibilityButton = toggle
            let exit = NSButton(title:"退出 Seasonote",target:self,action:#selector(quit))
            exit.bezelStyle = .rounded; exit.frame = NSRect(x:258,y:19,width:136,height:32); root.addSubview(exit)
            let note = NSTextField(labelWithString:"隐藏或退出不停止 QQ 音乐。")
            note.font = .systemFont(ofSize:11); note.textColor = .secondaryLabelColor
            note.frame = NSRect(x:26,y:25,width:225,height:18); root.addSubview(note)
            controlWindow = window
        }
        applyDesktopVisibility()
        controlWindow?.deminiaturize(nil)
        controlWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showDesktop()
        return false
    }

    func applicationDockMenu(_ sender:NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(item("显示桌面转盘",action:#selector(showDesktop)))
        menu.addItem(item("隐藏桌面转盘",action:#selector(hideDesktop)))
        menu.addItem(item("打开开关窗口…",action:#selector(showControls)))
        menu.addItem(item("创建桌面快捷方式",action:#selector(createDesktopShortcutFromMenu)))
        return menu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    private func item(_ title: String, action: Selector?, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func setupStatusMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "opticaldisc", accessibilityDescription: "Seasonote")
            button.title = " Seasonote"
            button.imagePosition = .imageLeading
            button.toolTip = "Seasonote · 显示、隐藏和退出"
        }
        let menu = NSMenu()
        let title = item("Seasonote", action: nil)
        menu.addItem(title)
        menu.addItem(item("打开开关窗口…", action:#selector(showControls)))
        menu.addItem(item("创建桌面快捷方式",action:#selector(createDesktopShortcutFromMenu)))
        let visibility = item("隐藏桌面转盘", action:#selector(toggleDesktopVisibility))
        visibilityMenuItem = visibility; menu.addItem(visibility)
        menu.addItem(item("拖动移动 · 四角缩放 · Shift 拖动指针", action: nil))
        menu.addItem(.separator())
        menu.addItem(item("居中显示", action: #selector(centerPanel)))
        let size = item("摆件大小", action: nil)
        let sizeMenu = NSMenu()
        for (label, width) in [("小 · 480", 480), ("中 · 640", 640), ("大 · 820", 820)] {
            let choice = item(label, action: #selector(resizePanel(_:)))
            choice.tag = width
            sizeMenu.addItem(choice)
        }
        size.submenu = sizeMenu
        menu.addItem(size)
        menu.addItem(.separator())
        menu.addItem(item("暂停 / 继续季节", action: #selector(togglePlay)))
        addSubmenu(menu, title: "循环速度", action: "speed", choices: [("原速 · 连续四季（约 25 秒）", "25.132741228718345"), ("60 秒 / 四季", "60"), ("120 秒 / 四季", "120")])
        addSubmenu(menu, title: "天气", action: "weather", choices: [("随四季变化", "auto"), ("风", "wind"), ("雨", "rain"), ("雪", "snow"), ("晴", "clear")])
        addSubmenu(menu, title: "画质", action: "quality", choices: [("高", "high"), ("中", "medium"), ("低", "low")])
        menu.addItem(.separator())
        menu.addItem(item("在浏览器中打开预览", action: #selector(openPreview)))
        menu.addItem(item("退出 Seasonote", action: #selector(quit), key: "q"))
        statusItem.menu = menu
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title:"Seasonote")
        appMenu.addItem(item("显示桌面转盘",action:#selector(showDesktop)))
        appMenu.addItem(item("隐藏桌面转盘",action:#selector(hideDesktop)))
        appMenu.addItem(item("打开开关窗口…",action:#selector(showControls)))
        appMenu.addItem(item("创建桌面快捷方式",action:#selector(createDesktopShortcutFromMenu)))
        appMenu.addItem(.separator())
        appMenu.addItem(item("退出 Seasonote",action:#selector(quit),key:"q"))
        appItem.submenu = appMenu; main.addItem(appItem); NSApp.mainMenu = main
    }

    private func addSubmenu(_ menu: NSMenu, title: String, action: String, choices: [(String, String)]) {
        let parent = item(title, action: nil)
        let submenu = NSMenu()
        for (label, value) in choices {
            let choice = item(label, action: #selector(sendMenuCommand(_:)))
            choice.representedObject = ["action": action, "value": value]
            submenu.addItem(choice)
        }
        parent.submenu = submenu
        menu.addItem(parent)
    }

    private func command(_ action: String, value: Any? = nil) {
        var detail: [String: Any] = ["action": action]
        if let value = value { detail["value"] = value }
        guard let bytes = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: bytes, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('seasons-command',{detail:\(json)}));", completionHandler: nil)
    }

    @objc private func sendMenuCommand(_ sender: NSMenuItem) {
        guard let values = sender.representedObject as? [String: String], let action = values["action"], let value = values["value"] else { return }
        if action == "speed" { command(action, value: Double(value) ?? 25.132741228718345) }
        else { command(action, value: value) }
    }
    @objc private func togglePlay() { command("togglePlay") }
    private func applyLevel() {
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
    }
    @objc private func centerPanel() {
        panel.center()
        lastPlacementAction = "centered"; persistPlacement()
        applyDesktopVisibility()
    }
    @objc private func resizePanel(_ sender: NSMenuItem) {
        let width = CGFloat(sender.tag)
        let height = width * 510 / 640
        let old = panel.frame
        var frame = NSRect(x: old.midX - width / 2, y: old.midY - height / 2, width: width, height: height)
        if let screen = panel.screen?.visibleFrame {
            frame.origin.x = max(screen.minX, min(frame.minX, screen.maxX - frame.width))
            frame.origin.y = max(screen.minY, min(frame.minY, screen.maxY - frame.height))
        }
        panel.setFrame(frame, display: true, animate: false)
        lastPlacementAction = "menu-resized"; persistPlacement()
    }
    @objc private func openPreview() {
        guard let url = localURL else { return }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.query = nil
        if let url = components.url { NSWorkspace.shared.open(url) }
    }
    @objc private func quit() { NSApp.terminate(nil) }
    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "四季转盘暂时无法打开"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        applyDesktopVisibility()
        musicReady = true; artworkWasSent = false; pushMusicState()
        guard let path = snapshotPath, !snapshotScheduled else { return }
        snapshotScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self = self else { return }
            self.webView.evaluateJavaScript("JSON.stringify({title:document.title,readyState:document.readyState,widget:window.__SEASONS_WIDGET__,appReady:window.appReady,frame:window.seasonScene?.frame,visibility:document.visibilityState,state:window.seasonScene?.state,glPrograms:window.seasonScene?.renderer?.info?.programs?.length,glFailures:window.seasonScene?.renderer?.info?.programs?.filter(p=>p.diagnostics?.runnable===false).length,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height})),music:window.musicState,musicArtwork:!!window.scene?._musicTexture,musicOpacity:document.querySelector('.music-controls')?getComputedStyle(document.querySelector('.music-controls')).opacity:null,errors:window.__nativeErrors})") { report, error in
                if let report = report { print("WIDGET_SMOKE_REPORT \(report)") }
                if let error = error { print("WIDGET_SMOKE_ERROR \(error.localizedDescription)") }
                self.webView.takeSnapshot(with: nil) { image, error in
                    if let image = image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                        do {
                            try png.write(to: URL(fileURLWithPath: path))
                            print("WIDGET_SNAPSHOT \(path)")
                            print("WIDGET_SNAPSHOT_ALPHA hasAlpha=\(bitmap.hasAlpha) corner=\(bitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? -1)")
                        } catch { print("WIDGET_SNAPSHOT_ERROR \(error.localizedDescription)") }
                    } else { print("WIDGET_SNAPSHOT_ERROR \(error?.localizedDescription ?? "No image")") }
                    NSApp.terminate(nil)
                }
            }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(error.localizedDescription)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func applicationWillTerminate(_ notification: Notification) {
        musicTimer?.invalidate(); musicBridge?.stop()
        diagnosticTimer?.invalidate()
        panel?.saveFrame(usingName: "SeasonOrnamentFrame")
        if let monitor = dragMonitor { NSEvent.removeMonitor(monitor) }
        assetServer?.stop()
    }
}

@main
enum SeasonDesktopMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = SeasonDesktop()
        app.delegate = delegate
        app.run()
    }
}
