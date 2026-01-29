using ManLab.Agent.Configuration;
using Microsoft.Extensions.Logging;
using System.Buffers;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ManLab.Agent.Commands;

internal sealed class ScriptRunner
{
    private const int ReadBufferChars = 1024;
    private const int MaxChunkCharsToSend = 2048;
    private static readonly TimeSpan ChunkFlushInterval = TimeSpan.FromMilliseconds(300);

    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger _logger;
    private readonly AgentConfiguration _config;
    private readonly Func<Guid, string, string?, Task> _updateStatusCallback;

    // Reuse sockets.
    private static readonly HttpClient Http = new();

    public ScriptRunner(
        ILoggerFactory loggerFactory,
        AgentConfiguration config,
        Func<Guid, string, string?, Task> updateStatusCallback)
    {
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<ScriptRunner>();
        _config = config;
        _updateStatusCallback = updateStatusCallback;
    }

    internal sealed record FetchedScript(string Shell, string Content);

    public static async Task<FetchedScript> FetchScriptAsync(
        ILogger logger,
        AgentConfiguration config,
        Guid scriptId,
        CancellationToken cancellationToken)
    {
        if (scriptId == Guid.Empty)
        {
            throw new ArgumentException("scriptId is required.", nameof(scriptId));
        }

        var apiBase = GetApiBaseUri(config.ServerUrl);
        var scriptUri = new Uri(apiBase, $"/api/scripts/{scriptId:D}");

        using var req = new HttpRequestMessage(HttpMethod.Get, scriptUri);
        if (!string.IsNullOrWhiteSpace(config.AuthToken))
        {
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", config.AuthToken);
        }

        using var resp = await Http.SendAsync(req, cancellationToken).ConfigureAwait(false);
        var json = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!resp.IsSuccessStatusCode)
        {
            logger.LogWarning("Failed to fetch script {ScriptId} from {Uri}: {Status} {Body}", scriptId, scriptUri, (int)resp.StatusCode, Truncate(json, 512));
            throw new InvalidOperationException($"Failed to fetch script {scriptId:D} from server (HTTP {(int)resp.StatusCode}).");
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var shell = root.TryGetProperty("shell", out var shellEl) && shellEl.ValueKind == JsonValueKind.String
                ? shellEl.GetString()
                : null;

            var content = root.TryGetProperty("content", out var contentEl) && contentEl.ValueKind == JsonValueKind.String
                ? contentEl.GetString()
                : null;

            if (string.IsNullOrWhiteSpace(shell) || content is null)
            {
                throw new InvalidOperationException("Server returned an invalid script payload.");
            }

            return new FetchedScript(shell!, content);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Failed to parse script JSON from server.");
            throw new InvalidOperationException("Server returned invalid JSON for script.", ex);
        }
    }

    public async Task<string> ExecuteAsync(
        Guid commandId,
        Guid runId,
        Guid scriptId,
        string shell,
        string content,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Script content is required.", nameof(content));
        }

        var maxOutputBytes = Math.Max(1024, _config.ScriptMaxOutputBytes);
        var timeout = TimeSpan.FromSeconds(Math.Max(1, _config.ScriptMaxDurationSeconds));

        var tempRoot = Path.Combine(Path.GetTempPath(), "ManLab", "scripts");
        Directory.CreateDirectory(tempRoot);

        var fileExt = GetScriptExtension(shell);
        var fileName = $"manlab-script-{scriptId:N}-{runId:N}-{DateTime.UtcNow:yyyyMMddHHmmss}{fileExt}";
        var scriptPath = Path.Combine(tempRoot, fileName);

        await File.WriteAllTextAsync(scriptPath, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), cancellationToken)
            .ConfigureAwait(false);

        // Best-effort: avoid leaving the script around.
        try
        {
            var (exe, args) = GetCommandLine(shell, scriptPath);

            _logger.LogInformation("Executing script.run: shell={Shell} exe={Exe} args={Args} runId={RunId} scriptId={ScriptId}", shell, exe, args, runId, scriptId);

            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = tempRoot
            };

            // Environment restrictions: keep only a small allowlist to reduce accidental secret leakage.
            ApplyRestrictedEnvironment(psi);

            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

            if (!process.Start())
            {
                throw new InvalidOperationException("Failed to start script process.");
            }

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            linkedCts.CancelAfter(timeout);

            var stdoutTail = new Utf8TailBuffer(maxOutputBytes);
            var stderrTail = new Utf8TailBuffer(maxOutputBytes);

            var stdoutSend = new ChunkSender(_updateStatusCallback, commandId, runId, scriptId, stream: "stdout");
            var stderrSend = new ChunkSender(_updateStatusCallback, commandId, runId, scriptId, stream: "stderr");

            var stdoutTask = PumpAsync(process.StandardOutput, stdoutTail, stdoutSend, linkedCts.Token);
            var stderrTask = PumpAsync(process.StandardError, stderrTail, stderrSend, linkedCts.Token);

            try
            {
                await process.WaitForExitAsync(linkedCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    _logger.LogWarning("Script exceeded timeout ({TimeoutSeconds}s); killing process.", timeout.TotalSeconds);
                    process.Kill(entireProcessTree: true);
                }
                catch { /* ignore */ }

                throw new TimeoutException($"Script exceeded max duration ({timeout.TotalSeconds:0}s).");
            }

            await Task.WhenAll(stdoutTask, stderrTask).ConfigureAwait(false);

            await stdoutSend.FlushAsync().ConfigureAwait(false);
            await stderrSend.FlushAsync().ConfigureAwait(false);

            var exitCode = process.ExitCode;
            var summary = $"Script completed. ExitCode={exitCode}.";

            // Also send a short final note as operational logs.
            await _updateStatusCallback(commandId, "InProgress", SerializeInfo(runId, scriptId, summary)).ConfigureAwait(false);

            if (exitCode != 0)
            {
                throw new InvalidOperationException($"Script failed (exit code {exitCode}).");
            }

            return summary;
        }
        finally
        {
            try { File.Delete(scriptPath); } catch { /* ignore */ }
        }
    }

    private static async Task PumpAsync(
        StreamReader reader,
        Utf8TailBuffer tail,
        ChunkSender sender,
        CancellationToken cancellationToken)
    {
        var buf = new char[ReadBufferChars];
        while (true)
        {
            var read = await reader.ReadAsync(buf, cancellationToken).ConfigureAwait(false);
            if (read <= 0)
            {
                break;
            }

            var s = new string(buf, 0, read);
            tail.Append(s);
            sender.Append(s);

            await sender.FlushIfDueAsync().ConfigureAwait(false);
        }
    }

    private static (string Exe, string Args) GetCommandLine(string shell, string scriptPath)
    {
        var normalized = shell.Trim().ToLowerInvariant();

        if (normalized == "bash")
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                // No attempt to locate WSL here; keep behavior explicit.
                throw new NotSupportedException("Bash scripts are supported on Linux agents only.");
            }

            return ("/bin/bash", $"\"{scriptPath}\"");
        }

        if (normalized == "powershell")
        {
            // Prefer pwsh (cross-platform), fall back to Windows PowerShell.
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                return ("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{scriptPath}\"");
            }

            return ("pwsh", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{scriptPath}\"");
        }

        throw new NotSupportedException($"Unsupported script shell '{shell}'.");
    }

    private static string GetScriptExtension(string shell)
    {
        var normalized = shell.Trim().ToLowerInvariant();
        return normalized switch
        {
            "bash" => ".sh",
            "powershell" => ".ps1",
            _ => ".txt"
        };
    }

    private void ApplyRestrictedEnvironment(ProcessStartInfo psi)
    {
        // Clear and rebuild a small, OS-appropriate set.
        psi.Environment.Clear();

        // Minimal allowlist.
        string[] allowed = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? ["PATH", "TEMP", "TMP", "SystemRoot", "ComSpec", "USERPROFILE", "USERNAME"]
            : ["PATH", "HOME", "USER", "TMPDIR", "LANG"];

        foreach (var key in allowed)
        {
            var v = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrEmpty(v))
            {
                psi.Environment[key] = v;
            }
        }

        // Explicit marker to let scripts detect they run under ManLab.
        psi.Environment["MANLAB"] = "1";
    }

    private static Uri GetApiBaseUri(string serverHubUrl)
    {
        if (!Uri.TryCreate(serverHubUrl, UriKind.Absolute, out var hubUri))
        {
            throw new InvalidOperationException("Agent ServerUrl is not a valid absolute URI.");
        }

        // Expected shape: http(s)://host:port/hubs/agent
        return new UriBuilder(hubUri)
        {
            Path = string.Empty,
            Query = string.Empty,
            Fragment = string.Empty
        }.Uri;
    }

    private static string SerializeInfo(Guid runId, Guid scriptId, string message)
    {
        return BuildJson(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("kind", "script.info");
            writer.WriteString("runId", runId);
            writer.WriteString("scriptId", scriptId);
            writer.WriteString("message", message);
            writer.WriteEndObject();
        });
    }

    private static string BuildJson(Action<Utf8JsonWriter> write)
    {
        var buffer = new ArrayBufferWriter<byte>(256);
        using var writer = new Utf8JsonWriter(buffer);
        write(writer);
        writer.Flush();
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static string? Truncate(string? s, int max)
    {
        if (string.IsNullOrEmpty(s)) return s;
        if (s.Length <= max) return s;
        return s[..max] + "…";
    }

    private sealed class ChunkSender
    {
        private readonly Func<Guid, string, string?, Task> _update;
        private readonly Guid _commandId;
        private readonly Guid _runId;
        private readonly Guid _scriptId;
        private readonly string _stream;

        private readonly StringBuilder _pending = new();
        private DateTime _lastFlushUtc = DateTime.UtcNow;

        public ChunkSender(Func<Guid, string, string?, Task> update, Guid commandId, Guid runId, Guid scriptId, string stream)
        {
            _update = update;
            _commandId = commandId;
            _runId = runId;
            _scriptId = scriptId;
            _stream = stream;
        }

        public void Append(string s)
        {
            if (string.IsNullOrEmpty(s)) return;

            // Bound in-memory pending chunk.
            if (_pending.Length + s.Length > MaxChunkCharsToSend)
            {
                var remaining = MaxChunkCharsToSend - _pending.Length;
                if (remaining > 0)
                {
                    _pending.Append(s.AsSpan(0, Math.Min(remaining, s.Length)));
                }
            }
            else
            {
                _pending.Append(s);
            }
        }

        public async Task FlushIfDueAsync()
        {
            var now = DateTime.UtcNow;
            if (_pending.Length >= MaxChunkCharsToSend || (now - _lastFlushUtc) >= ChunkFlushInterval)
            {
                await FlushAsync().ConfigureAwait(false);
            }
        }

        public async Task FlushAsync()
        {
            if (_pending.Length == 0) return;

            var chunk = _pending.ToString();
            _pending.Clear();
            _lastFlushUtc = DateTime.UtcNow;

            var payload = BuildJson(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("kind", "script.output");

                if (_runId == Guid.Empty)
                {
                    writer.WriteNull("runId");
                }
                else
                {
                    writer.WriteString("runId", _runId);
                }

                if (_scriptId == Guid.Empty)
                {
                    writer.WriteNull("scriptId");
                }
                else
                {
                    writer.WriteString("scriptId", _scriptId);
                }

                writer.WriteString("stream", _stream);
                writer.WriteString("chunk", chunk);
                writer.WriteEndObject();
            });

            await _update(_commandId, "InProgress", payload).ConfigureAwait(false);
        }
    }

    private sealed class Utf8TailBuffer
    {
        private readonly int _maxBytes;
        private readonly Queue<(string Text, int Bytes)> _chunks = new();
        private int _bytes;

        public Utf8TailBuffer(int maxBytes)
        {
            _maxBytes = Math.Max(0, maxBytes);
        }

        public void Append(string s)
        {
            if (_maxBytes <= 0 || string.IsNullOrEmpty(s)) return;

            var b = Encoding.UTF8.GetByteCount(s);
            _chunks.Enqueue((s, b));
            _bytes += b;

            while (_bytes > _maxBytes && _chunks.Count > 0)
            {
                var removed = _chunks.Dequeue();
                _bytes -= removed.Bytes;
            }
        }
    }
}
