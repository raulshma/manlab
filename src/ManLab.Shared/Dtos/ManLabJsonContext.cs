using System.Text.Json.Serialization;

namespace ManLab.Shared.Dtos;

/// <summary>
/// System.Text.Json source-generated serialization context.
/// Required for NativeAOT scenarios where reflection-based serialization is disabled.
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(NodeMetadata))]
[JsonSerializable(typeof(NodeRegisteredDto))]
[JsonSerializable(typeof(TelemetryData))]
[JsonSerializable(typeof(Dictionary<string, float>))]
[JsonSerializable(typeof(Guid))]
[JsonSerializable(typeof(Guid?))]
public partial class ManLabJsonContext : JsonSerializerContext;
