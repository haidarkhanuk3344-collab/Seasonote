using System;
using System.Collections.Generic;
using System.Threading.Tasks;
namespace System { public static class TestAsyncExtensions { public static Task<T> AsTask<T>(this Task<T> task)=>task; } }
namespace Windows.Storage.Streams {
 public interface IRandomAccessStreamReference { Task<StreamData> OpenReadAsync(); }
 public sealed class StreamData:IDisposable { public byte[] Data=[]; public ulong Size=>(ulong)Data.Length; public void Dispose(){} }
 public sealed class Thumbnail(byte[] bytes,int delay=0):IRandomAccessStreamReference { public async Task<StreamData> OpenReadAsync(){await Task.Delay(delay);return new(){Data=bytes};} }
 public sealed class DataReader(StreamData input):IDisposable { public uint UnconsumedBufferLength=>(uint)input.Data.Length;public Task<uint> LoadAsync(uint size)=>Task.FromResult(size);public void ReadBytes(byte[] target)=>input.Data.CopyTo(target,0); public void Dispose(){} }
}
namespace Windows.Media.Control {
 public sealed class CurrentSessionChangedEventArgs:EventArgs{}
 public sealed class SessionsChangedEventArgs:EventArgs{}
 public sealed class MediaPropertiesChangedEventArgs:EventArgs{}
 public sealed class PlaybackInfoChangedEventArgs:EventArgs{}
 public sealed class TimelinePropertiesChangedEventArgs:EventArgs{}
 public enum GlobalSystemMediaTransportControlsSessionPlaybackStatus {Closed,Opened,Changing,Stopped,Playing,Paused}
 public sealed class GlobalSystemMediaTransportControlsSessionMediaProperties {
 public string Title="",Artist="",AlbumTitle=""; public Windows.Storage.Streams.IRandomAccessStreamReference? Thumbnail;
 }
 public sealed class PlaybackControls { public bool IsPlayEnabled=true,IsPauseEnabled=true,IsPlayPauseToggleEnabled=true,IsPreviousEnabled=true,IsNextEnabled=true,IsPlaybackPositionEnabled=true; }
 public sealed class PlaybackInfo { public GlobalSystemMediaTransportControlsSessionPlaybackStatus PlaybackStatus=GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused;public double? PlaybackRate=1;public PlaybackControls Controls=new(); }
 public sealed class Timeline { public TimeSpan StartTime,EndTime=TimeSpan.FromSeconds(180),Position=TimeSpan.FromSeconds(20); public DateTimeOffset LastUpdatedTime=DateTimeOffset.UtcNow; }
 public sealed class GlobalSystemMediaTransportControlsSession {
 public string SourceAppUserModelId="QQMusic";public GlobalSystemMediaTransportControlsSessionMediaProperties Media=new();public PlaybackInfo Playback=new();public Timeline Timeline=new();
 public int MetadataDelay;public readonly List<(string,long)> Commands=new();
 public event Action<GlobalSystemMediaTransportControlsSession,MediaPropertiesChangedEventArgs>? MediaPropertiesChanged;
 public event Action<GlobalSystemMediaTransportControlsSession,PlaybackInfoChangedEventArgs>? PlaybackInfoChanged;
 public event Action<GlobalSystemMediaTransportControlsSession,TimelinePropertiesChangedEventArgs>? TimelinePropertiesChanged;
 public async Task<GlobalSystemMediaTransportControlsSessionMediaProperties> TryGetMediaPropertiesAsync(){var snapshot=Media;await Task.Delay(MetadataDelay);return snapshot;}
 public PlaybackInfo GetPlaybackInfo()=>Playback;public Timeline GetTimelineProperties()=>Timeline;
 public void MediaChanged()=>MediaPropertiesChanged?.Invoke(this,new()); public void PlaybackChanged()=>PlaybackInfoChanged?.Invoke(this,new());public void TimelineChanged()=>TimelinePropertiesChanged?.Invoke(this,new());
 public Task<bool> TryPlayAsync(){Commands.Add(("play",0));Playback.PlaybackStatus=GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;return Task.FromResult(true);}
 public Task<bool> TryPauseAsync(){Commands.Add(("pause",0));Playback.PlaybackStatus=GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused;return Task.FromResult(true);}
 public Task<bool> TryTogglePlayPauseAsync(){Commands.Add(("toggle",0));return Task.FromResult(true);}
 public Task<bool> TrySkipPreviousAsync(){Commands.Add(("previous",0));return Task.FromResult(true);}
 public Task<bool> TrySkipNextAsync(){Commands.Add(("next",0));return Task.FromResult(true);}
 public Task<bool> TryChangePlaybackPositionAsync(long ticks){Commands.Add(("seek",ticks));Timeline.Position=TimeSpan.FromTicks(ticks);return Task.FromResult(true);}
 }
 public sealed class GlobalSystemMediaTransportControlsSessionManager {
 public static GlobalSystemMediaTransportControlsSessionManager Instance=new();public List<GlobalSystemMediaTransportControlsSession> All=new();public GlobalSystemMediaTransportControlsSession? Current;
 public event Action<GlobalSystemMediaTransportControlsSessionManager,CurrentSessionChangedEventArgs>? CurrentSessionChanged;
 public event Action<GlobalSystemMediaTransportControlsSessionManager,SessionsChangedEventArgs>? SessionsChanged;
 public static Task<GlobalSystemMediaTransportControlsSessionManager> RequestAsync()=>Task.FromResult(Instance);
 public IReadOnlyList<GlobalSystemMediaTransportControlsSession> GetSessions()=>All.ToArray();public GlobalSystemMediaTransportControlsSession? GetCurrentSession()=>Current;
 public void Replace(params GlobalSystemMediaTransportControlsSession[] values){All=[..values];Current=All.Count>0?All[0]:null;SessionsChanged?.Invoke(this,new());CurrentSessionChanged?.Invoke(this,new());}
 }
}
