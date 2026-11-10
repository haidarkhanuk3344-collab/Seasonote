import AppKit

// A self-contained media connection. No CUA, browser automation, screen capture,
// account credentials or network requests are used by this bridge.
final class MusicBridge {
    var onChange: (() -> Void)?
    var state: [String: Any] = [:]
    var error = "正在连接系统播放器…"
    var lastCommand = "尚未发送命令"
    private var stream: Process?
    private var buffer = Data()
    private let readQueue = DispatchQueue(label: "seasons.music.decode")
    private let commandQueue = DispatchQueue(label: "seasons.music.commands")
    private let lifecycleLock = NSLock()
    private let shutdownLock = NSLock()
    private var activeProcesses: [ObjectIdentifier: Process] = [:]
    private var stopping = false
    private let resource: URL
    init(resource: URL) { self.resource = resource }
    private func makeProcess(_ args: [String]) -> Process {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
        p.arguments = [resource.appendingPathComponent("mediaremote-adapter.pl").path,
                       resource.appendingPathComponent("MediaRemoteAdapter.framework").path] + args
        return p
    }
    private var isStopped: Bool {
        lifecycleLock.lock(); defer { lifecycleLock.unlock() }
        return stopping
    }
    // Serialize launching and registration with stop(), so a helper can never
    // start after shutdown has taken its snapshot of owned processes.
    @discardableResult private func launch(_ process: Process, asStream: Bool = false) throws -> Bool {
        lifecycleLock.lock(); defer { lifecycleLock.unlock() }
        guard !stopping else {
            throw NSError(domain: "MusicBridge", code: NSUserCancelledError,
                          userInfo: [NSLocalizedDescriptionKey: "媒体连接已停止"])
        }
        if asStream, stream != nil { return false }
        try process.run()
        activeProcesses[ObjectIdentifier(process)] = process
        if asStream { stream = process }
        return true
    }
    private func forget(_ process: Process) {
        lifecycleLock.lock(); defer { lifecycleLock.unlock() }
        activeProcesses.removeValue(forKey: ObjectIdentifier(process))
        if stream === process { stream = nil }
    }
    func start() {
        guard !isStopped else { return }
        let p = makeProcess(["stream", "--no-diff", "--micros", "--debounce=100"])
        let output = Pipe(), errors = Pipe()
        p.standardOutput = output; p.standardError = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let self else { return }
            self.readQueue.async {
                self.buffer.append(data)
                guard self.buffer.count < 16 * 1024 * 1024 else { self.buffer.removeAll(); return }
                while let index = self.buffer.firstIndex(of: 10) {
                    let line = self.buffer.prefix(upTo: index)
                    self.buffer.removeSubrange(...index)
                    if let message = try? JSONSerialization.jsonObject(with: line) as? [String:Any],
                       let payload = message["payload"] as? [String:Any] {
                        DispatchQueue.main.async { self.accept(payload) }
                    }
                }
            }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        p.terminationHandler = { [weak self] process in
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            self?.forget(process)
            DispatchQueue.main.async {
                guard let self, !self.isStopped else { return }
                self.state = [:]; self.error = "媒体连接已中断，请重新打开验证器。"
                self.onChange?()
            }
        }
        do {
            if try !launch(p, asStream: true) {
                output.fileHandleForReading.readabilityHandler = nil
                errors.fileHandleForReading.readabilityHandler = nil
            }
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            guard !isStopped else { return }
            self.error = error.localizedDescription; onChange?()
        }
    }
    private func accept(_ payload: [String:Any]) {
        guard !isStopped else { return }
        state = payload
        error = payload["bundleIdentifier"] == nil ? "没有播放器发布媒体信息，请先在 QQ 音乐中播放一首歌。" : ""
        onChange?()
    }
    private func run(_ args: [String]) throws -> Data {
        let p = makeProcess(args), output = Pipe(), errors = Pipe()
        p.standardOutput = output; p.standardError = errors
        var stderr = Data()
        let lock = NSLock()
        errors.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            lock.lock(); stderr.append(data); lock.unlock()
        }
        defer { errors.fileHandleForReading.readabilityHandler = nil }
        try launch(p)
        defer { forget(p) }
        let timeout = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 8, execute: timeout)
        let data = output.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit(); timeout.cancel()
        errors.fileHandleForReading.readabilityHandler = nil
        guard p.terminationStatus == 0 else {
            lock.lock(); let detail = String(data:stderr,encoding:.utf8) ?? ""; lock.unlock()
            throw NSError(domain: "MusicBridge", code:Int(p.terminationStatus), userInfo:[NSLocalizedDescriptionKey:detail.isEmpty ? "媒体命令失败或超时" : detail])
        }
        return data
    }
    func refresh(_ completion: ((Bool) -> Void)? = nil) {
        guard !isStopped else { completion?(false); return }
        commandQueue.async {
            do {
                let data = try self.run(["get", "--micros"])
                let value = try JSONSerialization.jsonObject(with:data, options:.fragmentsAllowed)
                DispatchQueue.main.async {
                    guard !self.isStopped else { completion?(false); return }
                    self.accept(value as? [String:Any] ?? [:]); completion?(true)
                }
            } catch { DispatchQueue.main.async {
                if !self.isStopped { self.error = error.localizedDescription; self.onChange?() }
                completion?(false)
            } }
        }
    }
    func command(_ name: String, seconds: Double? = nil, completion: ((Bool) -> Void)? = nil) {
        guard !isStopped else { completion?(false); return }
        let source = state["bundleIdentifier"] as? String
        guard let source, !source.isEmpty else { completion?(false); return }
        let ids = ["play":"0", "pause":"1", "toggle":"2", "next":"4", "previous":"5"]
        var args: [String]
        if name == "seek", let seconds, seconds.isFinite, seconds >= 0,
           let duration = state["durationMicros"] as? Double, seconds <= duration / 1e6 {
            args = ["seek", String(Int64(seconds * 1e6))]
        } else if let id = ids[name] { args = ["send", id] }
        else { completion?(false); return }
        lastCommand = "正在发送 \(name)…"; onChange?()
        commandQueue.async {
            do {
                // Recheck ownership immediately before a global media command.
                let current = try JSONSerialization.jsonObject(with:self.run(["get", "--micros", "--no-artwork"]), options:.fragmentsAllowed) as? [String:Any]
                guard current?["bundleIdentifier"] as? String == source else {
                    throw NSError(domain:"MusicBridge",code:2,userInfo:[NSLocalizedDescriptionKey:"活动播放器已改变，本次命令已取消。"])
                }
                _ = try self.run(args)
                DispatchQueue.main.async {
                    guard !self.isStopped else { completion?(false); return }
                    self.lastCommand = "\(name) 已发送，结果以播放器返回状态为准"
                    self.onChange?()
                    self.refresh(completion)
                }
            } catch {
                DispatchQueue.main.async {
                    if !self.isStopped { self.lastCommand = "\(name) 失败：\(error.localizedDescription)"; self.onChange?() }
                    completion?(false)
                }
            }
        }
    }
    var playing: Bool { state["playing"] as? Bool ?? false }
    var duration: Double? { (state["durationMicros"] as? Double).map { $0 / 1e6 } }
    var position: Double? {
        guard let base = state["elapsedTimeMicros"] as? Double else { return nil }
        var result = base / 1e6
        // QQ Music can report playbackRate=1 even while paused. The playing flag
        // must gate interpolation, or a paused track incorrectly runs to its end.
        if playing, let stamp = state["timestampEpochMicros"] as? Double {
            let rate = state["playbackRate"] as? Double ?? 1
            result += max(0, Date().timeIntervalSince1970 - stamp / 1e6) * max(0, rate)
        }
        return max(0, min(duration ?? Double.greatestFiniteMagnitude, result))
    }
    func summary() -> [String:Any] {
        var s = state
        s.removeValue(forKey:"artworkData")
        s["artworkBytes"] = (state["artworkData"] as? String).flatMap { Data(base64Encoded:$0)?.count } ?? 0
        s["positionSeconds"] = position ?? NSNull() as Any
        s["observedAt"] = Date().timeIntervalSince1970
        s["foregroundBundle"] = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        s["bridgeError"] = error
        s["lastCommand"] = lastCommand
        return s
    }
    func stop() {
        shutdownLock.lock(); defer { shutdownLock.unlock() }
        lifecycleLock.lock()
        stopping = true
        let processes = Array(activeProcesses.values)
        activeProcesses.removeAll(); stream = nil
        lifecycleLock.unlock()
        for process in processes where process.isRunning { process.terminate() }
        // Application termination will remove our asynchronous timeout queue.
        // Finish shutdown here, including a bounded fallback for a stuck helper.
        let deadline = ProcessInfo.processInfo.systemUptime + 0.25
        while processes.contains(where: { $0.isRunning }), ProcessInfo.processInfo.systemUptime < deadline {
            Thread.sleep(forTimeInterval: 0.01)
        }
        for process in processes where process.isRunning {
            kill(process.processIdentifier, SIGKILL)
            process.waitUntilExit()
        }
    }
    deinit { stop() }
}
