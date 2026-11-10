import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var bridge: MusicBridge!
    let artwork = NSImageView()
    let title = NSTextField(labelWithString:"等待音乐连接")
    let artist = NSTextField(labelWithString:"")
    let status = NSTextField(wrappingLabelWithString:"")
    let timing = NSTextField(labelWithString:"— / —")
    let result = NSTextField(wrappingLabelWithString:"")
    let slider = NSSlider(value:0,minValue:0,maxValue:1,target:nil,action:nil)
    var buttons: [NSButton] = []
    var currentArtwork: String?
    var timer: Timer?
    var verification: [[String:Any]] = []
    var verifyPath: String?
    var initial: [String:Any] = [:]
    var initialPosition: Double?
    var pendingFailure: String?
    func argument(_ key:String) -> String? {
        let a=CommandLine.arguments
        guard let i=a.firstIndex(of:key), a.indices.contains(i+1) else { return nil }; return a[i+1]
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        bridge = MusicBridge(resource:Bundle.main.resourceURL!)
        bridge.onChange = { [weak self] in self?.render() }
        verifyPath = argument("--verify")
        if verifyPath == nil { setupWindow() }
        bridge.start()
        timer = Timer.scheduledTimer(withTimeInterval:0.25,repeats:true) { [weak self] _ in self?.renderTime() }
        if verifyPath != nil {
            DispatchQueue.main.asyncAfter(deadline:.now()+2) { self.beginVerification() }
        }
    }
    func setupWindow() {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect:NSRect(x:0,y:0,width:640,height:460),styleMask:[.titled,.closable,.miniaturizable],backing:.buffered,defer:false)
        window.title = "四季 · 音乐连接验证器"
        window.center()
        let content=window.contentView!
        let heading=NSTextField(labelWithString:"真实播放连接")
        heading.font = .systemFont(ofSize:24,weight:.semibold)
        heading.frame=NSRect(x:28,y:402,width:560,height:32);content.addSubview(heading)
        let subtitle=NSTextField(labelWithString:"由独立程序读取系统播放器；可将 QQ 音乐留在后台。")
        subtitle.textColor = .secondaryLabelColor;subtitle.frame=NSRect(x:28,y:373,width:580,height:22);content.addSubview(subtitle)
        artwork.frame=NSRect(x:28,y:183,width:160,height:160);artwork.imageScaling = .scaleProportionallyUpOrDown;content.addSubview(artwork)
        title.font = .systemFont(ofSize:23,weight:.medium);title.frame=NSRect(x:212,y:299,width:400,height:35);content.addSubview(title)
        artist.font = .systemFont(ofSize:16);artist.frame=NSRect(x:212,y:268,width:400,height:26);content.addSubview(artist)
        status.textColor = .secondaryLabelColor;status.frame=NSRect(x:212,y:191,width:395,height:66);content.addSubview(status)
        slider.frame=NSRect(x:28,y:143,width:460,height:26);slider.target=self;slider.action=#selector(seek);slider.isContinuous=false;content.addSubview(slider)
        timing.frame=NSRect(x:500,y:146,width:116,height:23);timing.font = .monospacedDigitSystemFont(ofSize:12,weight:.regular);content.addSubview(timing)
        for (i,item) in [("上一首","previous"),("播放","play"),("暂停","pause"),("下一首","next")].enumerated() {
            let b=NSButton(title:item.0,target:self,action:#selector(control(_:)));b.identifier=NSUserInterfaceItemIdentifier(item.1);b.bezelStyle = .rounded
            b.frame=NSRect(x:28+i*109,y:91,width:100,height:34);content.addSubview(b);buttons.append(b)
        }
        let refresh=NSButton(title:"重新读取",target:self,action:#selector(reload));refresh.bezelStyle = .rounded;refresh.frame=NSRect(x:494,y:91,width:116,height:34);content.addSubview(refresh)
        result.font = .systemFont(ofSize:11);result.textColor = .secondaryLabelColor;result.frame=NSRect(x:28,y:17,width:584,height:61);content.addSubview(result)
        window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
    }
    @objc func control(_ sender:NSButton) { bridge.command(sender.identifier!.rawValue) }
    @objc func reload() { bridge.refresh() }
    @objc func seek() { bridge.command("seek",seconds:slider.doubleValue) }
    func render() {
        guard window != nil else { return }
        title.stringValue = bridge.state["title"] as? String ?? "等待音乐连接"
        artist.stringValue = bridge.state["artist"] as? String ?? "歌手信息未提供"
        let source=bridge.state["bundleIdentifier"] as? String ?? "无"
        let hasArt=(bridge.state["artworkData"] as? String) != nil
        status.stringValue = bridge.error.isEmpty ? "\(bridge.playing ? "正在播放" : "已暂停") · \(source)\n封面：\(hasArt ? "已读取" : "未提供")　时间：\(bridge.position == nil ? "未提供" : "已读取")" : bridge.error
        let art=bridge.state["artworkData"] as? String
        if art != currentArtwork { currentArtwork=art;artwork.image=art.flatMap{Data(base64Encoded:$0)}.flatMap{NSImage(data:$0)} }
        buttons.forEach { $0.isEnabled=bridge.state["bundleIdentifier"] != nil && bridge.error.isEmpty }
        result.stringValue = "\(bridge.lastCommand)\nMac 连接使用非公开系统媒体接口，后续系统更新兼容性仍需验证。"
        renderTime()
    }
    func format(_ v:Double?) -> String { guard let v, v.isFinite else { return "—" }; return String(format:"%02d:%02d",Int(v)/60,Int(v)%60) }
    func renderTime() {
        guard window != nil else { return }
        let d=bridge.duration,p=bridge.position
        timing.stringValue="\(format(p)) / \(format(d))"
        slider.isEnabled=d != nil && p != nil && (d ?? 0)>0
        slider.maxValue=max(1,d ?? 1);slider.doubleValue=p ?? 0
    }
    func record(_ step:String,_ passed:Bool,_ detail:String="") {
        verification.append(["step":step,"passed":passed,"detail":detail,"state":bridge.summary()])
        print("\(passed ? "PASS" : "FAIL") \(step) \(detail)");fflush(stdout)
        saveReport()
    }
    func saveReport() {
        guard let path=verifyPath else { return }
        let report:[String:Any] = ["platform":"macOS", "system":ProcessInfo.processInfo.operatingSystemVersionString,"verifiedBy":"standalone application using bundled MediaRemote adapter", "results":verification]
        if let data=try? JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:URL(fileURLWithPath:path),options:.atomic) }
    }
    func after(_ seconds:Double,_ block:@escaping()->Void) { DispatchQueue.main.asyncAfter(deadline:.now()+seconds,execute:block) }
    func beginVerification() {
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier != "com.apple.loginwindow" else {
            record("unlocked_session",false,"请解锁后重试；锁屏下不执行控制验收。")
            bridge.stop(); NSApp.terminate(nil); return
        }
        bridge.refresh { ok in
            self.initial=self.bridge.state;self.initialPosition=self.bridge.position
            let valid=ok && self.bridge.state["bundleIdentifier"] as? String == "com.tencent.QQMusicMac"
            self.record("connected_qqmusic",valid)
            guard valid else { self.finish();return }
            let d=self.bridge.state
            self.record("title_artist",d["title"] is String && d["artist"] is String)
            self.record("artwork",(d["artworkData"] as? String).flatMap{Data(base64Encoded:$0)}.flatMap{NSImage(data:$0)} != nil)
            self.record("timeline",self.bridge.position != nil && (self.bridge.duration ?? 0)>0)
            self.bridge.command("play") { sent in self.after(2) {
                self.bridge.refresh { _ in
                    self.record("play",sent && self.bridge.playing)
                    let before=self.bridge.position ?? -1
                    self.after(2) {
                        self.record("progress_advances",(self.bridge.position ?? -1)>before+1)
                        self.checkPause()
                    }
                }
            }}
        }
    }
    func checkPause() {
        bridge.command("pause") { sent in self.after(1) {
            self.bridge.refresh { _ in
                self.record("pause",sent && !self.bridge.playing)
                let before=self.bridge.position ?? -1
                self.after(1.5) {
                    self.record("paused_progress_stable",abs((self.bridge.position ?? -100)-before)<0.2)
                    self.checkSeek()
                }
            }
        }}
    }
    func checkSeek() {
        let target=min(35,(bridge.duration ?? 70)/2)
        bridge.command("seek",seconds:target) { sent in self.after(1) {
            self.bridge.refresh { _ in
                self.record("seek",sent && abs((self.bridge.position ?? -100)-target)<2,"requestedSeconds=\(target)")
                self.checkNext()
            }
        }}
    }
    func checkNext() {
        let old=bridge.state["title"] as? String
        bridge.command("next") { sent in self.after(2) {
            self.bridge.refresh { _ in
                let changed=self.bridge.state["title"] as? String != old
                self.record("next",sent && changed)
                if changed { self.bridge.command("previous") { sent in self.after(2) {
                    self.bridge.refresh { _ in
                        self.record("previous",sent && self.bridge.state["title"] as? String == old)
                        self.restore()
                    }
                }}} else { self.restore() }
            }
        }}
    }
    func restore() {
        bridge.command("pause") { _ in
            let same=self.bridge.state["title"] as? String == self.initial["title"] as? String
            if same, let seconds=self.initialPosition {
                self.bridge.command("seek",seconds:seconds) { _ in self.restorePlaying() }
            } else { self.restorePlaying() }
        }
    }
    func restorePlaying() {
        let name = initial["playing"] as? Bool == true ? "play" : "pause"
        bridge.command(name) { _ in self.after(1) {
            self.bridge.refresh { _ in self.finish() }
        }}
    }
    func finish() {
        let appIDs=verification.compactMap { ($0["state"] as? [String:Any])?["foregroundBundle"] as? String }
        record("qqmusic_stays_background",!appIDs.contains("com.tencent.QQMusicMac"))
        record("restored_play_state",bridge.playing == (initial["playing"] as? Bool ?? false))
        saveReport();bridge.stop();NSApp.terminate(nil)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool { true }
    func applicationWillTerminate(_ notification:Notification) { timer?.invalidate();bridge.stop() }
}
let app=NSApplication.shared
let delegate=AppDelegate()
app.delegate=delegate
app.setActivationPolicy(.accessory)
app.run()
