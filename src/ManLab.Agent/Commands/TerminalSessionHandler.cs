using ManLab.Agent.Configuration;
using Microsoft.Extensions.Logging;
using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ManLab.Agent.Commands;

/// <summary>
/// Manages agent-side terminal sessions.
/// Provides restricted shell execution with bounded output and duration.
/// </summary>
public sealed class TerminalSessionHandler : IDisposable
{
    private readonly ILogger<TerminalSessionHandler> _logger;
    private readonly AgentConfiguration _config;
    private readonly Func<Guid, string, bool, Task> _sendOutputCallback;

    private readonly ConcurrentDictionary<Guid, SessionState> _sessions = new();
    private bool _disposed;

    public TerminalSessionHandler(
        ILogger<TerminalSessionHandler> logger,
        AgentConfiguration config,
        Func<Guid, string, bool, Task> sendOutputCallback)
    {
        _logger = logger;
        _config = config;
        _sendOutputCallback = sendOutputCallback;
    }

    private sealed class SessionState : IDisposable
    {
        public Guid SessionId { get; init; }
        public Process? Process { get; set; }
        public CancellationTokenSource Cts { get; } = new();
        public DateTime StartedAt { get; init; } = DateTime.UtcNow;
        public int OutputBytesSent { get; set; }
        public bool IsClosed { get; set; }

        public void Dispose()
        {
            Cts.Cancel();
            Cts.Dispose();

            try
            {
                if (Process is not null && !Process.HasExited)
                {
                    Process.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                // Process may have already exited
            }

            Process?.Dispose();
        }
    }

    /// <summary>
    /// Opens a new terminal session.
    /// </summary>
    public async Task<string> OpenAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        if (_sessions.Count > 0)
        {
            throw new InvalidOperationException("Only one terminal session per agent is allowed.");
        }

        if (_sessions.ContainsKey(sessionId))
        {
            throw new InvalidOperationException($"Session {sessionId} already exists.");
        }

        var state = new SessionState { SessionId = sessionId };
        if (!_sessions.TryAdd(sessionId, state))
        {
            state.Dispose();
            throw new InvalidOperationException($"Failed to create session {sessionId}.");
        }

        try
        {
            // Start shell process
            var startInfo = CreateShellStartInfo();
            var process = new Process { StartInfo = startInfo };
            process.Start();
            state.Process = process;

            _logger.LogInformation("Terminal session {SessionId} opened, process PID={Pid}", sessionId, process.Id);

            // Start background output pumping
            _ = PumpOutputAsync(state, cancellationToken);

            // Start session timeout monitor
            _ = MonitorTimeoutAsync(state);

            return $"Terminal session {sessionId} opened.";
        }
        catch (Exception ex)
        {
            _sessions.TryRemove(sessionId, out _);
            state.Dispose();
            throw new InvalidOperationException($"Failed to start shell: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Sends input to a terminal session.
    /// </summary>
    public async Task<string> SendInputAsync(Guid sessionId, string input)
    {
        if (!_sessions.TryGetValue(sessionId, out var state))
        {
            throw new InvalidOperationException($"Session {sessionId} not found.");
        }

        if (state.IsClosed || state.Process is null || state.Process.HasExited)
        {
            await CloseAsync(sessionId);
            throw new InvalidOperationException($"Session {sessionId} is no longer active.");
        }

        try
        {
            await state.Process.StandardInput.WriteAsync(input);
            await state.Process.StandardInput.FlushAsync();

            _logger.LogDebug("Sent {Length} chars to session {SessionId}", input.Length, sessionId);
            return $"Sent {input.Length} characters.";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send input to session {SessionId}", sessionId);
            await CloseAsync(sessionId);
            throw new InvalidOperationException($"Failed to send input: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Closes a terminal session.
    /// </summary>
    public async Task<string> CloseAsync(Guid sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var state))
        {
            return $"Session {sessionId} not found or already closed.";
        }

        state.IsClosed = true;
        state.Dispose();

        _logger.LogInformation("Terminal session {SessionId} closed.", sessionId);

        // Notify server that session is closed
        try
        {
            await _sendOutputCallback(sessionId, string.Empty, true).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to notify server of session close for {SessionId}", sessionId);
        }

        return $"Session {sessionId} closed.";
    }

    /// <summary>
    /// Checks if a session exists.
    /// </summary>
    public bool SessionExists(Guid sessionId) => _sessions.ContainsKey(sessionId);

    private ProcessStartInfo CreateShellStartInfo()
    {
        string shell, args;

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            shell = "powershell.exe";
            args = "-NoLogo -NoProfile -ExecutionPolicy Bypass -Command -";
        }
        else
        {
            // Linux/macOS
            shell = "/bin/bash";
            args = "--norc --noprofile -i";
        }

        return new ProcessStartInfo
        {
            FileName = shell,
            Arguments = args,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
    }

    private async Task PumpOutputAsync(SessionState state, CancellationToken externalCancellation)
    {
        var linked = CancellationTokenSource.CreateLinkedTokenSource(state.Cts.Token, externalCancellation);
        var cancellationToken = linked.Token;

        try
        {
            var buffer = new StringBuilder();
            var flushInterval = TimeSpan.FromMilliseconds(100);
            var lastFlush = DateTime.UtcNow;
            var maxOutputBytes = Math.Max(1024, _config.TerminalMaxOutputBytes);

            var stdoutTask = PumpStreamAsync(state.Process!.StandardOutput, buffer, "stdout", state, maxOutputBytes, cancellationToken);
            var stderrTask = PumpStreamAsync(state.Process!.StandardError, buffer, "stderr", state, maxOutputBytes, cancellationToken);

            // Flush buffered output periodically
            while (!cancellationToken.IsCancellationRequested && !state.IsClosed)
            {
                await Task.Delay(flushInterval, cancellationToken).ConfigureAwait(false);

                if (buffer.Length > 0 && state.OutputBytesSent < maxOutputBytes)
                {
                    var chunk = buffer.ToString();
                    buffer.Clear();

                    var remaining = maxOutputBytes - state.OutputBytesSent;
                    if (chunk.Length > remaining)
                    {
                        chunk = chunk[..remaining];
                    }

                    state.OutputBytesSent += chunk.Length;

                    try
                    {
                        await _sendOutputCallback(state.SessionId, chunk, false).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send output for session {SessionId}", state.SessionId);
                    }

                    // Check if we hit the output limit
                    if (state.OutputBytesSent >= maxOutputBytes)
                    {
                        _logger.LogWarning("Session {SessionId} output limit reached ({Bytes} bytes)", state.SessionId, maxOutputBytes);
                        await CloseAsync(state.SessionId).ConfigureAwait(false);
                        break;
                    }
                }

                // Check if process has exited
                if (state.Process?.HasExited == true)
                {
                    // Final flush
                    if (buffer.Length > 0)
                    {
                        try
                        {
                            await _sendOutputCallback(state.SessionId, buffer.ToString(), false).ConfigureAwait(false);
                        }
                        catch { }
                    }

                    await CloseAsync(state.SessionId).ConfigureAwait(false);
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on cancellation
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Output pump failed for session {SessionId}", state.SessionId);
            await CloseAsync(state.SessionId).ConfigureAwait(false);
        }
        finally
        {
            linked.Dispose();
        }
    }

    private async Task PumpStreamAsync(
        StreamReader reader,
        StringBuilder buffer,
        string streamName,
        SessionState state,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        var charBuffer = ArrayPool<char>.Shared.Rent(4096);
        try
        {
            while (!cancellationToken.IsCancellationRequested && !state.IsClosed)
            {
                var read = await reader.ReadAsync(charBuffer.AsMemory(0, charBuffer.Length), cancellationToken).ConfigureAwait(false);
                if (read == 0)
                {
                    break;
                }

                lock (buffer)
                {
                    buffer.Append(charBuffer, 0, read);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "{Stream} pump ended for session {SessionId}", streamName, state.SessionId);
        }
        finally
        {
            ArrayPool<char>.Shared.Return(charBuffer);
        }
    }

    private async Task MonitorTimeoutAsync(SessionState state)
    {
        var maxDuration = TimeSpan.FromSeconds(Math.Max(60, _config.TerminalMaxDurationSeconds));

        try
        {
            await Task.Delay(maxDuration, state.Cts.Token).ConfigureAwait(false);

            if (!state.IsClosed)
            {
                _logger.LogWarning("Session {SessionId} timed out after {Duration}", state.SessionId, maxDuration);
                await CloseAsync(state.SessionId).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Session was closed before timeout
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        foreach (var kvp in _sessions)
        {
            kvp.Value.Dispose();
        }
        _sessions.Clear();
    }
}
