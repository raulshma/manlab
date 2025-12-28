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
[JsonSerializable(typeof(AgentCapabilities))]
[JsonSerializable(typeof(AgentToolCapabilities))]
[JsonSerializable(typeof(AgentFeatureCapabilities))]
[JsonSerializable(typeof(TelemetryData))]
[JsonSerializable(typeof(GpuTelemetry))]
[JsonSerializable(typeof(List<GpuTelemetry>))]
[JsonSerializable(typeof(UpsTelemetry))]
[JsonSerializable(typeof(ServiceStatusSnapshotIngest))]
[JsonSerializable(typeof(List<ServiceStatusSnapshotIngest>))]
[JsonSerializable(typeof(SmartDriveSnapshotIngest))]
[JsonSerializable(typeof(List<SmartDriveSnapshotIngest>))]
[JsonSerializable(typeof(GpuSnapshotIngest))]
[JsonSerializable(typeof(List<GpuSnapshotIngest>))]
[JsonSerializable(typeof(UpsSnapshotIngest))]
[JsonSerializable(typeof(List<UpsSnapshotIngest>))]
[JsonSerializable(typeof(Dictionary<string, float>))]
[JsonSerializable(typeof(Dictionary<string, object>))]
[JsonSerializable(typeof(Dictionary<string, object?>))]
[JsonSerializable(typeof(Guid))]
[JsonSerializable(typeof(Guid?))]
public partial class ManLabJsonContext : JsonSerializerContext;
