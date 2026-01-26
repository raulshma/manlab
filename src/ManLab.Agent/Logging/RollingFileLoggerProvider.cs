using Microsoft.Extensions.Logging;
using System.Text;

namespace ManLab.Agent.Logging;

/// <summary>
/// Very small, AOT-friendly rolling file logger for the agent.
/// Designed to support the remote log viewer (log.read/log.tail) for agent self-logs
/// without pulling in heavy logging dependencies.
/// </summary>
internal sealed class RollingFileLoggerProvider : ILoggerProvider
{
    private readonly object _lock = new();
    private readonly string _filePath;
    private readonly int _maxBytes;
    private readonly int _retainedFiles;

    private FileStream? _stream;
    private StreamWriter? _writer;
    private long _approxBytes;

    private const int StringBuilderCacheMax = 1024;

    public RollingFileLoggerProvider(string filePath, int maxBytes, int retainedFiles)
    {
        _filePath = filePath;
        _maxBytes = Math.Max(64 * 1024, maxBytes);
        _retainedFiles = Math.Clamp(retainedFiles, 1, 20);

        EnsureWriter();
    }

    public ILogger CreateLogger(string categoryName) => new RollingFileLogger(this, categoryName);

    public void Dispose()
    {
        lock (_lock)
        {
            try { _writer?.Dispose(); } catch { }
            try { _stream?.Dispose(); } catch { }
            _writer = null;
            _stream = null;
        }
    }

    private void EnsureWriter()
    {
        var dir = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrWhiteSpace(dir))
        {
            Directory.CreateDirectory(dir);
        }

        // Initialize size from existing file.
        try
        {
            if (File.Exists(_filePath))
            {
                _approxBytes = new FileInfo(_filePath).Length;
            }
        }
        catch
        {
            _approxBytes = 0;
        }

        // Use FileShare.ReadWrite so the agent can tail its own log while writing.
        _stream = new FileStream(_filePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        _writer = new StreamWriter(_stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false))
        {
            AutoFlush = true
        };
    }

    private void RotateIfNeeded_NoThrow()
    {
        // Caller must hold _lock.
        if (_approxBytes < _maxBytes)
        {
            return;
        }

        try
        {
            _writer?.Dispose();
            _stream?.Dispose();
            _writer = null;
            _stream = null;

            // Shift existing files: .(n-1) -> .n
            for (var i = _retainedFiles - 1; i >= 1; i--)
            {
                var src = _filePath + "." + i;
                var dst = _filePath + "." + (i + 1);
                if (File.Exists(dst))
                {
                    File.Delete(dst);
                }
                if (File.Exists(src))
                {
                    File.Move(src, dst);
                }
            }

            var first = _filePath + ".1";
            if (File.Exists(first))
            {
                File.Delete(first);
            }
            if (File.Exists(_filePath))
            {
                File.Move(_filePath, first);
            }

            _approxBytes = 0;
            EnsureWriter();
        }
        catch
        {
            // Best-effort only; never crash the agent due to logging.
            try { EnsureWriter(); } catch { }
        }
    }

    private static string FormatLevel(LogLevel level) => level switch
    {
        LogLevel.Trace => "TRACE",
        LogLevel.Debug => "DEBUG",
        LogLevel.Information => "INFO",
        LogLevel.Warning => "WARN",
        LogLevel.Error => "ERROR",
        LogLevel.Critical => "CRIT",
        _ => "NONE"
    };

    private static class StringBuilderCache
    {
        [ThreadStatic]
        private static StringBuilder? _cached;

        public static StringBuilder Acquire(int capacity)
        {
            var sb = _cached;
            if (sb is not null)
            {
                _cached = null;
                sb.Clear();
                if (sb.Capacity < capacity)
                {
                    sb.Capacity = capacity;
                }
                return sb;
            }

            return new StringBuilder(capacity);
        }

        public static string GetStringAndRelease(StringBuilder sb)
        {
            var result = sb.ToString();
            if (sb.Capacity <= StringBuilderCacheMax)
            {
                _cached = sb;
            }

            return result;
        }
    }

    internal void WriteLine(LogLevel level, string category, EventId eventId, string message, Exception? exception)
    {
        if (_writer is null)
        {
            return;
        }

        var ts = DateTimeOffset.UtcNow.ToString("O");
        var sb = StringBuilderCache.Acquire(256);
        sb.Append(ts);
        sb.Append(' ');
        sb.Append(FormatLevel(level));
        sb.Append(' ');
        sb.Append(category);

        if (eventId.Id != 0 || !string.IsNullOrWhiteSpace(eventId.Name))
        {
            sb.Append(" [");
            sb.Append(eventId.Id);
            if (!string.IsNullOrWhiteSpace(eventId.Name))
            {
                sb.Append(':');
                sb.Append(eventId.Name);
            }
            sb.Append(']');
        }

        sb.Append(" - ");
        sb.Append(message);

        if (exception is not null)
        {
            sb.Append("\n");
            sb.Append(exception);
        }

        sb.Append("\n");
        var line = StringBuilderCache.GetStringAndRelease(sb);

        lock (_lock)
        {
            try
            {
                RotateIfNeeded_NoThrow();

                _writer?.Write(line);
                // Approximate size in UTF-8; good enough for rotation.
                _approxBytes += Encoding.UTF8.GetByteCount(line);
            }
            catch
            {
                // Best-effort only.
            }
        }
    }

    private sealed class RollingFileLogger : ILogger
    {
        private readonly RollingFileLoggerProvider _provider;
        private readonly string _category;

        public RollingFileLogger(RollingFileLoggerProvider provider, string category)
        {
            _provider = provider;
            _category = category;
        }

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            string message;
            try
            {
                message = formatter(state, exception);
            }
            catch
            {
                message = state?.ToString() ?? string.Empty;
            }

            _provider.WriteLine(logLevel, _category, eventId, message, exception);
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}
