using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Seasonote;

/// <summary>
/// Public Windows system-media sessions. No accounts, keystrokes, process
/// injection or QQ installation scanning. All state notifications are worker
/// thread callbacks: the UI host must dispatch them onto its UI thread.
/// </summary>
internal sealed class MusicBridge : IDisposable
{
    public event Action<Dictionary<string, object?>>? StateChanged;
    public string LastError { get; private set; } = "";
    private readonly object gate = new();
    private readonly object notifications = new();
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim wake = new(0, 1);
    private readonly SemaphoreSlim commands = new(1, 1);
    private GlobalSystemMediaTransportControlsSessionManager? manager;
    private GlobalSystemMediaTransportControlsSession? session;
    private Task? worker;
    private bool disposed;
    private long mediaRevision;
    private long sessionEpoch;
    private long artEpoch;
    private DateTimeOffset mediaRead = DateTimeOffset.MinValue;
    private DateTimeOffset artworkRead = DateTimeOffset.MinValue;
    private string trackKey = "";
    private string? artwork;
    private string? sentArtwork;
    private bool artworkSent;
    private Dictionary<string, object?> state = EmptyState();
    private static readonly TimeSpan OperationTimeout = TimeSpan.FromSeconds(3);
    private const uint MaxArtworkBytes = 8 * 1024 * 1024;

    public Task StartAsync()
    {
        lock (gate)
        {
            if (disposed || worker is not null) return Task.CompletedTask;
            worker = Task.Run(RunAsync);
        }
        return Task.CompletedTask;
    }

    private async Task RunAsync()
    {
        while (!lifetime.IsCancellationRequested)
        {
            try
            {
                if (manager is null)
                {
                    var created = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync()
                        .AsTask().WaitAsync(OperationTimeout, lifetime.Token).ConfigureAwait(false);
                    lock (gate)
                    {
                        if (disposed) return;
                        manager = created;
                        created.CurrentSessionChanged += CurrentSessionChanged;
                        created.SessionsChanged += SessionsChanged;
                    }
                }
                await RefreshAsync().ConfigureAwait(false);
                await wake.WaitAsync(TimeSpan.FromMilliseconds(500), lifetime.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { return; }
            catch (Exception error)
            {
                LastError = error.Message;
                ClearSession();
                Disconnect();
                ReleaseManager();
                try { await Task.Delay(1500, lifetime.Token).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private void CurrentSessionChanged(GlobalSystemMediaTransportControlsSessionManager sender, CurrentSessionChangedEventArgs args) => Signal(true);
    private void SessionsChanged(GlobalSystemMediaTransportControlsSessionManager sender, SessionsChangedEventArgs args) => Signal(true);
    private void MediaChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args) => Signal(true);
    private void PlaybackChanged(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args) => Signal(false);
    private void TimelineChanged(GlobalSystemMediaTransportControlsSession sender, TimelinePropertiesChangedEventArgs args) => Signal(false);
    private void Signal(bool metadata)
    {
        lock (gate)
        {
            if (disposed) return;
            if (metadata) { mediaRevision++; mediaRead = DateTimeOffset.MinValue; }
        }
        try { wake.Release(); } catch (SemaphoreFullException) { }
    }

    // Prefer the system's active session. If it retains a paused session while
    // another player starts, follow the playing session. A paused valid track
    // remains available so the play button can resume it.
    private GlobalSystemMediaTransportControlsSession? SelectSession()
    {
        var owner = manager;
        if (owner is null) return null;
        var all = owner.GetSessions();
        if (all.Count == 0) return null;
        var current = owner.GetCurrentSession();
        if (current is not null && !all.Any(s => SameSession(s, current))) current = null;
        if (current is not null && IsPlaying(current)) return current;
        return all.FirstOrDefault(IsPlaying) ?? current
            ?? all.FirstOrDefault(s => SameSession(s, session))
            ?? all.FirstOrDefault(s => s.SourceAppUserModelId.Contains("qqmusic", StringComparison.OrdinalIgnoreCase))
            ?? all[0];
    }
    private static bool IsPlaying(GlobalSystemMediaTransportControlsSession s)
    {
        try { return s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing; }
        catch { return false; }
    }
    private static bool SameSession(GlobalSystemMediaTransportControlsSession? a, GlobalSystemMediaTransportControlsSession? b)
        => a is not null && b is not null && a.Equals(b);

    private async Task RefreshAsync()
    {
        var selected = SelectSession();
        if (selected is null) { ClearSession(); Disconnect(); return; }
        long revision, epoch;
        bool readMedia;
        bool sourceChanged = false;
        lock (gate)
        {
            if (disposed) return;
            if (!SameSession(session, selected))
            {
                UnsubscribeSession();
                session = selected;
                selected.MediaPropertiesChanged += MediaChanged;
                selected.PlaybackInfoChanged += PlaybackChanged;
                selected.TimelinePropertiesChanged += TimelineChanged;
                sessionEpoch++; artEpoch++; mediaRevision++;
                mediaRead = DateTimeOffset.MinValue; artworkRead = DateTimeOffset.MinValue;
                trackKey = ""; artwork = null; state = EmptyState();
                sourceChanged = true;
            }
            epoch = sessionEpoch; revision = mediaRevision;
            readMedia = DateTimeOffset.UtcNow - mediaRead > TimeSpan.FromSeconds(2);
        }
        if (sourceChanged) PublishCurrentState(false);
        GlobalSystemMediaTransportControlsSessionMediaProperties? media = null;
        if (readMedia)
        {
            media = await selected.TryGetMediaPropertiesAsync().AsTask()
                .WaitAsync(OperationTimeout, lifetime.Token).ConfigureAwait(false);
            // A source/track event during the await means this result is stale.
            lock (gate) { if (disposed || epoch != sessionEpoch || revision != mediaRevision) return; }
            if (!SameSession(selected, SelectSession())) return;
        }
        var playback = selected.GetPlaybackInfo();
        var timeline = selected.GetTimelineProperties();
        var controls = playback.Controls;
        var playing = playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        var start = timeline.StartTime.TotalSeconds;
        var end = timeline.EndTime.TotalSeconds;
        var duration = double.IsFinite(end - start) && end > start ? end - start : (double?)null;
        var position = timeline.Position.TotalSeconds - start;
        if (playing)
        {
            var age = (DateTimeOffset.UtcNow - timeline.LastUpdatedTime).TotalSeconds;
            // An uninitialized Windows timestamp must not seek the display to
            // the end of the track. Normal timestamps can be old during play.
            if (timeline.LastUpdatedTime > DateTimeOffset.UnixEpoch && double.IsFinite(age) && age >= 0)
                position += age * Math.Max(0, playback.PlaybackRate ?? 1);
        }
        double? shownPosition = double.IsFinite(position) && duration.HasValue ? Math.Clamp(position, 0, duration.Value) : null;
        IRandomAccessStreamReference? thumbnail = null;
        string imageTrack = "";
        long imageEpoch = 0;
        lock (gate)
        {
            if (disposed || epoch != sessionEpoch) return;
            if (media is not null)
            {
                state["title"] = media.Title?.Trim() ?? "";
                state["artist"] = media.Artist?.Trim() ?? "";
                state["source"] = selected.SourceAppUserModelId?.Trim() ?? "";
                var key = state["source"] + "\n" + state["title"] + "\n" + state["artist"] + "\n" + media.AlbumTitle;
                if (trackKey != key)
                {
                    trackKey = key; artEpoch++; artwork = null; artworkRead = DateTimeOffset.MinValue;
                    state["commandError"] = "";
                }
                mediaRead = DateTimeOffset.UtcNow;
                if (media.Thumbnail is null)
                {
                    artwork = null; artEpoch++;
                }
                else if (DateTimeOffset.UtcNow - artworkRead > TimeSpan.FromSeconds(15))
                {
                    thumbnail = media.Thumbnail; imageTrack = trackKey; imageEpoch = ++artEpoch;
                    artworkRead = DateTimeOffset.UtcNow;
                }
            }
            var connected = !string.IsNullOrWhiteSpace(state["title"] as string)
                && !string.IsNullOrWhiteSpace(state["source"] as string)
                && playback.PlaybackStatus != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Closed;
            state["connected"] = connected; state["playing"] = connected && playing;
            state["position"] = connected ? shownPosition : null;
            state["duration"] = connected ? duration : null;
            state["error"] = "";
            state["capabilities"] = new Dictionary<string, bool>
            {
                ["previous"] = connected && controls.IsPreviousEnabled,
                ["next"] = connected && controls.IsNextEnabled,
                ["toggle"] = connected && (controls.IsPlayPauseToggleEnabled || (playing ? controls.IsPauseEnabled : controls.IsPlayEnabled)),
                ["seek"] = connected && controls.IsPlaybackPositionEnabled && duration.HasValue
            };
            if (!connected) { artwork = null; thumbnail = null; artEpoch++; }
        }
        LastError = "";
        PublishCurrentState(false);
        if (thumbnail is not null) _ = ReadArtworkAsync(thumbnail, imageTrack, epoch, imageEpoch);
    }

    private async Task ReadArtworkAsync(IRandomAccessStreamReference reference, string key, long epoch, long request)
    {
        try
        {
            using var input = await reference.OpenReadAsync().AsTask()
                .WaitAsync(OperationTimeout, lifetime.Token).ConfigureAwait(false);
            if (input.Size == 0 || input.Size > MaxArtworkBytes) return;
            using var reader = new DataReader(input);
            await reader.LoadAsync((uint)input.Size).AsTask()
                .WaitAsync(OperationTimeout, lifetime.Token).ConfigureAwait(false);
            var bytes = new byte[reader.UnconsumedBufferLength]; reader.ReadBytes(bytes);
            var mime = ImageMime(bytes);
            if (mime is null) return;
            var data = "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
            lock (gate)
            {
                if (disposed || sessionEpoch != epoch || artEpoch != request || trackKey != key) return;
                artwork = data;
            }
            PublishCurrentState(false);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch { /* Metadata and controls remain available without cover art. */ }
    }
    private static string? ImageMime(byte[] data)
    {
        if (data.Length >= 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4e && data[3] == 0x47) return "image/png";
        if (data.Length >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff) return "image/jpeg";
        if (data.Length >= 12 && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46
            && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50) return "image/webp";
        return null;
    }

    public void PublishCurrentState(bool includeArtwork = true)
    {
        // Serialize cover-art and playback notifications so a late dispatcher
        // enqueue cannot put an older snapshot after the newer player state.
        lock (notifications)
        {
            Dictionary<string, object?> snapshot;
            Action<Dictionary<string, object?>>? handler;
            lock (gate)
            {
                if (disposed) return;
                snapshot = new(state);
                if (includeArtwork || !artworkSent || artwork != sentArtwork)
                {
                    snapshot["artwork"] = artwork; sentArtwork = artwork; artworkSent = true;
                }
                handler = StateChanged;
            }
            // The host dispatches asynchronously; no blocking UI invocation.
            try { handler?.Invoke(snapshot); } catch { }
        }
    }

    public async Task CommandAsync(string action, double? value = null)
    {
        if (action == "refresh") { Signal(true); PublishCurrentState(); return; }
        if (!new[] { "play", "pause", "toggle", "previous", "next", "seek" }.Contains(action)) return;
        GlobalSystemMediaTransportControlsSession? target = null;
        try
        {
            await commands.WaitAsync(lifetime.Token).ConfigureAwait(false);
            try
            {
                lock (gate)
                {
                    if (disposed || state["connected"] is not true) return;
                    target = session;
                }
                if (target is null || !SameSession(target, SelectSession())) return;
                var playback = target.GetPlaybackInfo(); var controls = playback.Controls;
                var playing = playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                var effective = action == "toggle" && !controls.IsPlayPauseToggleEnabled ? (playing ? "pause" : "play") : action;
                var supported = effective switch
                {
                    "play" => controls.IsPlayEnabled, "pause" => controls.IsPauseEnabled,
                    "toggle" => controls.IsPlayPauseToggleEnabled,
                    "previous" => controls.IsPreviousEnabled, "next" => controls.IsNextEnabled,
                    "seek" => controls.IsPlaybackPositionEnabled, _ => false
                };
                if (!supported) { SetCommandError("播放器暂不支持此操作。", target); return; }
                long ticks = 0;
                if (effective == "seek")
                {
                    var timeline = target.GetTimelineProperties();
                    var duration = (timeline.EndTime - timeline.StartTime).TotalSeconds;
                    if (!value.HasValue || !double.IsFinite(value.Value) || value.Value < 0 || value.Value > duration || duration <= 0) return;
                    ticks = checked(timeline.StartTime.Ticks + TimeSpan.FromSeconds(value.Value).Ticks);
                }
                var operation = effective switch
                {
                    "play" => target.TryPlayAsync(), "pause" => target.TryPauseAsync(),
                    "toggle" => target.TryTogglePlayPauseAsync(), "previous" => target.TrySkipPreviousAsync(),
                    "next" => target.TrySkipNextAsync(), "seek" => target.TryChangePlaybackPositionAsync(ticks),
                    _ => throw new InvalidOperationException()
                };
                var accepted = await operation.AsTask().WaitAsync(OperationTimeout, lifetime.Token).ConfigureAwait(false);
                SetCommandError(accepted ? "" : "播放器没有接受这次操作。", target);
                Signal(true);
            }
            finally { commands.Release(); }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error)
        {
            LastError = error.Message;
            if (target is not null) SetCommandError("音乐操作失败，请稍后重试。", target);
            Signal(true);
        }
    }
    private void SetCommandError(string text, GlobalSystemMediaTransportControlsSession target)
    {
        lock (gate)
        {
            if (disposed || !SameSession(session, target)) return;
            state["commandError"] = text;
        }
        PublishCurrentState(false);
    }

    private static Dictionary<string, object?> EmptyState() => new()
    {
        ["connected"] = false, ["playing"] = false, ["title"] = "", ["artist"] = "", ["source"] = "",
        ["position"] = null, ["duration"] = null, ["error"] = "", ["commandError"] = "",
        ["capabilities"] = new Dictionary<string, bool> { ["previous"] = false, ["toggle"] = false, ["next"] = false, ["seek"] = false }
    };
    private void Disconnect()
    {
        lock (gate)
        {
            if (disposed) return;
            state = EmptyState(); artwork = null; trackKey = ""; artEpoch++;
        }
        PublishCurrentState(false);
    }
    private void UnsubscribeSession()
    {
        if (session is null) return;
        try { session.MediaPropertiesChanged -= MediaChanged; } catch { }
        try { session.PlaybackInfoChanged -= PlaybackChanged; } catch { }
        try { session.TimelinePropertiesChanged -= TimelineChanged; } catch { }
        session = null;
    }
    private void ClearSession()
    {
        lock (gate) { UnsubscribeSession(); sessionEpoch++; mediaRead = DateTimeOffset.MinValue; }
    }
    private void ReleaseManager()
    {
        lock (gate)
        {
            if (manager is null) return;
            try { manager.CurrentSessionChanged -= CurrentSessionChanged; } catch { }
            try { manager.SessionsChanged -= SessionsChanged; } catch { }
            manager = null;
        }
    }
    public void Dispose()
    {
        lock (notifications)
        lock (gate)
        {
            if (disposed) return;
            disposed = true; StateChanged = null;
            sessionEpoch++; artEpoch++;
            lifetime.Cancel(); UnsubscribeSession(); ReleaseManager();
        }
        // Do not synchronously wait for WinRT or the UI dispatcher during app
        // shutdown. Cancellation prevents every pending operation publishing.
    }
}
