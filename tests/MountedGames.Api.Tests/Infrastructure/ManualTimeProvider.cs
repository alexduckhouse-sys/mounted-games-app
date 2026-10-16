namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>A small clock with real TimeProvider timers; no wall-clock delays in streaming tests.</summary>
public sealed class ManualTimeProvider : TimeProvider
{
    private readonly object _gate = new();
    private DateTimeOffset _now = new(2030, 6, 1, 12, 0, 0, TimeSpan.Zero);
    private readonly List<ManualTimer> _timers = new();
    public override DateTimeOffset GetUtcNow() { lock (_gate) return _now; }
    public override long GetTimestamp() => GetUtcNow().Ticks;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        lock (_gate)
        {
            var timer = new ManualTimer(this, callback, state);
            _timers.Add(timer);
            timer.Change(dueTime, period);
            return timer;
        }
    }

    public void Advance(TimeSpan by)
    {
        var target = GetUtcNow() + by;
        while (true)
        {
            ManualTimer? next;
            lock (_gate)
            {
                next = _timers.Where(t => t.Due <= target).OrderBy(t => t.Due).FirstOrDefault();
                if (next is null) { _now = target; return; }
                _now = next.Due;
                next.Due = next.Period > TimeSpan.Zero ? _now + next.Period : DateTimeOffset.MaxValue;
            }
            next.Callback(next.State);
        }
    }

    private sealed class ManualTimer(ManualTimeProvider clock, TimerCallback callback, object? state) : ITimer
    {
        public TimerCallback Callback => callback;
        public object? State => state;
        public DateTimeOffset Due { get; set; }
        public TimeSpan Period { get; private set; }
        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            lock (clock._gate)
            {
                Due = dueTime == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : clock._now + dueTime;
                Period = period;
                return true;
            }
        }
        public void Dispose() { lock (clock._gate) clock._timers.Remove(this); }
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
}
